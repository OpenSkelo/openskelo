import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { nanoid } from "nanoid";
import { getDB } from "./db.js";
import type {
  BlockOutput,
  BlockStep,
  RunContext,
  RunEvent,
  RunModel,
  RunStepInput,
  RunStepRecord,
  RunStepResult,
} from "../types.js";

const TRANSITIONS: Record<BlockStep, BlockStep> = {
  NORA_PLAN: "REI_BUILD",
  REI_BUILD: "MARI_REVIEW",
  MARI_REVIEW: "DONE",
  DONE: "NORA_PLAN",
};

const VALID_BLOCKS: BlockStep[] = ["NORA_PLAN", "REI_BUILD", "MARI_REVIEW", "DONE"];

export function createRunEngine(opts?: { baseDir?: string }) {
  const db = getDB();
  const baseDir = opts?.baseDir ?? process.cwd();

  const insertRun = db.prepare(`
    INSERT INTO runs (
      id, original_prompt, current_block, iteration, run_version, status,
      artifact_path, artifact_preview, context, blocks
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getRunStmt = db.prepare("SELECT * FROM runs WHERE id = ?");
  const updateRunStmt = db.prepare(`
    UPDATE runs
    SET current_block=?, iteration=?, status=?, artifact_path=?, artifact_preview=?, context=?, blocks=?, run_version=run_version+1, updated_at=datetime('now')
    WHERE id=? AND run_version=?
  `);

  const insertEventStmt = db.prepare(`
    INSERT INTO run_events (id, run_id, block, transition, result, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const getEventsStmt = db.prepare(
    "SELECT * FROM run_events WHERE run_id = ? ORDER BY created_at ASC"
  );

  const insertStepStmt = db.prepare(`
    INSERT INTO run_steps (
      id, run_id, step_index, transition, block, iteration,
      agent, output, artifact_path, artifact_preview, context_snapshot, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getStepsStmt = db.prepare(`
    SELECT * FROM run_steps
    WHERE run_id = ?
    ORDER BY step_index ASC, created_at ASC
  `);

  const getStepCountStmt = db.prepare(`
    SELECT COUNT(1) as count FROM run_steps WHERE run_id = ?
  `);

  const getIdempotencyStmt = db.prepare(`
    SELECT * FROM run_step_idempotency
    WHERE run_id = ? AND idempotency_key = ?
  `);

  const insertIdempotencyStmt = db.prepare(`
    INSERT INTO run_step_idempotency (id, run_id, idempotency_key, request_hash, status_code, response_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  function createRun(input: { originalPrompt: string; context?: RunContext }): RunModel {
    const run: RunModel = {
      id: `RUN-${nanoid(8)}`,
      original_prompt: input.originalPrompt,
      current_block: "NORA_PLAN",
      iteration: 1,
      run_version: 0,
      status: "running",
      artifact_path: null,
      artifact_preview: null,
      context: input.context ?? {},
      blocks: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    insertRun.run(
      run.id,
      run.original_prompt,
      run.current_block,
      run.iteration,
      run.run_version,
      run.status,
      run.artifact_path,
      run.artifact_preview,
      JSON.stringify(run.context),
      JSON.stringify(run.blocks)
    );

    logEvent(run.id, run.current_block, "create", "pass", {
      message: "Run created",
      original_prompt: run.original_prompt,
    });

    return run;
  }

  function getRun(id: string): RunModel | null {
    const row = getRunStmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return rowToRun(row);
  }

  function getEvents(runId: string): RunEvent[] {
    const rows = getEventsStmt.all(runId) as Record<string, unknown>[];
    return rows.map(rowToEvent);
  }

  function listSteps(runId: string): RunStepRecord[] {
    const rows = getStepsStmt.all(runId) as Record<string, unknown>[];
    return rows.map(rowToStep);
  }

  function setContext(runId: string, context: RunContext): RunModel {
    const run = getRun(runId);
    if (!run) throw new Error("Run not found");

    const merged = { ...run.context, ...context };
    persist({ ...run, context: merged });

    logEvent(runId, run.current_block, "context:update", "pass", { context });

    return getRun(runId)!;
  }

  const stepTxn = db.transaction((runId: string, input: RunStepInput): RunStepResult => {
    const runRow = getRunStmt.get(runId) as Record<string, unknown> | undefined;
    if (!runRow) {
      return { ok: false, error: "Run not found", status: 404 };
    }

    const run = rowToRun(runRow);
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    const requestHash = hashStepRequest({
      reviewApproved: input.reviewApproved,
      contextPatch: input.contextPatch,
    });

    if (idempotencyKey) {
      const existing = getIdempotencyStmt.get(runId, idempotencyKey) as
        | { request_hash: string; response_json: string }
        | undefined;

      if (existing) {
        if (existing.request_hash !== requestHash) {
          return {
            ok: false,
            error: "Idempotency key has already been used with a different payload",
            status: 409,
            code: "IDEMPOTENCY_KEY_REUSED",
          };
        }

        const parsed = safeJson<RunStepResult>(existing.response_json, {
          ok: false,
          error: "Stored idempotent response is invalid",
          status: 500,
        });

        if (parsed.ok) return { ...parsed, deduplicated: true };
        return parsed;
      }
    }

    if (!VALID_BLOCKS.includes(run.current_block)) {
      const failure: RunStepResult = {
        ok: false,
        error: `Invalid transition source state: ${run.current_block}`,
        status: 400,
      };
      persistIdempotency(run.id, idempotencyKey, requestHash, failure);
      return failure;
    }

    const next = TRANSITIONS[run.current_block];
    if (!next) {
      const failure: RunStepResult = {
        ok: false,
        error: `Invalid transition: ${run.current_block} has no next block`,
        status: 400,
      };
      persistIdempotency(run.id, idempotencyKey, requestHash, failure);
      return failure;
    }

    const mergedContext = { ...run.context, ...(input.contextPatch ?? {}) };

    const gate = evaluateGate(run, next, input, mergedContext);
    if (!gate.pass) {
      logEvent(run.id, run.current_block, `${run.current_block}->${next}`, "fail", {
        gate,
      });
      const failure: RunStepResult = {
        ok: false,
        error: "Gate failure",
        status: 400,
        gate,
      };
      persistIdempotency(run.id, idempotencyKey, requestHash, failure);
      return failure;
    }

    const output = buildOutput(run, next, mergedContext);
    persistArtifact(baseDir, output.artifact_path, output.artifact_preview);

    const transition = `${run.current_block}->${next}`;
    const stepCountRow = getStepCountStmt.get(run.id) as { count?: number } | undefined;
    const stepIndex = Number(stepCountRow?.count ?? 0) + 1;
    const stepRecord: RunStepRecord = {
      id: nanoid(),
      run_id: run.id,
      step_index: stepIndex,
      transition,
      ...output,
    };

    insertStepStmt.run(
      stepRecord.id,
      stepRecord.run_id,
      stepRecord.step_index,
      stepRecord.transition,
      stepRecord.block,
      stepRecord.iteration,
      stepRecord.agent,
      stepRecord.output,
      stepRecord.artifact_path,
      stepRecord.artifact_preview,
      JSON.stringify(stepRecord.context_snapshot),
      stepRecord.timestamp
    );

    const nextIteration = run.current_block === "DONE" ? run.iteration + 1 : run.iteration;

    const updated: RunModel = {
      ...run,
      current_block: next,
      iteration: nextIteration,
      context: mergedContext,
      artifact_path: output.artifact_path ?? run.artifact_path,
      artifact_preview: output.artifact_preview ?? run.artifact_preview,
      blocks: [...run.blocks, output],
      run_version: run.run_version + 1,
    };

    const updateResult = updateRunStmt.run(
      updated.current_block,
      updated.iteration,
      updated.status,
      updated.artifact_path,
      updated.artifact_preview,
      JSON.stringify(updated.context),
      JSON.stringify(updated.blocks),
      updated.id,
      run.run_version
    );

    if (Number(updateResult.changes) !== 1) {
      return {
        ok: false,
        error: "Run state changed concurrently. Retry with an idempotency key.",
        status: 409,
        code: "RUN_STEP_CONFLICT",
      };
    }

    logEvent(run.id, updated.current_block, transition, "pass", {
      output,
      step_index: stepIndex,
    });

    const finalRun = rowToRun(getRunStmt.get(run.id) as Record<string, unknown>);
    const result: RunStepResult = {
      ok: true,
      run: finalRun,
      events: getEvents(run.id),
    };

    persistIdempotency(run.id, idempotencyKey, requestHash, result);
    return result;
  });

  function step(runId: string, input: RunStepInput): RunStepResult {
    return stepTxn(runId, input);
  }

  function persistIdempotency(
    runId: string,
    idempotencyKey: string | undefined,
    requestHash: string,
    response: RunStepResult
  ): void {
    if (!idempotencyKey) return;
    insertIdempotencyStmt.run(
      nanoid(),
      runId,
      idempotencyKey,
      requestHash,
      response.ok ? 200 : response.status,
      JSON.stringify(response)
    );
  }

  function getArtifact(runId: string): {
    artifact_path: string | null;
    preview: string | null;
    file_path: string | null;
    persisted: boolean;
  } | null {
    const run = getRun(runId);
    if (!run) return null;
    const filePath = run.artifact_path ? resolve(baseDir, ".skelo", trimLeadingSlash(run.artifact_path)) : null;
    return {
      artifact_path: run.artifact_path,
      preview: run.artifact_preview,
      file_path: filePath,
      persisted: filePath ? existsSync(filePath) : false,
    };
  }

  function getArtifactContent(runId: string): { content: string; file_path: string } | null {
    const artifact = getArtifact(runId);
    if (!artifact?.file_path || !existsSync(artifact.file_path)) return null;
    return {
      content: readFileSync(artifact.file_path, "utf8"),
      file_path: artifact.file_path,
    };
  }

  function persist(run: RunModel): void {
    updateRunStmt.run(
      run.current_block,
      run.iteration,
      run.status,
      run.artifact_path,
      run.artifact_preview,
      JSON.stringify(run.context),
      JSON.stringify(run.blocks),
      run.id,
      run.run_version
    );
  }

  function logEvent(
    runId: string,
    block: BlockStep,
    transition: string,
    result: "pass" | "fail",
    details: Record<string, unknown>
  ): void {
    insertEventStmt.run(nanoid(), runId, block, transition, result, JSON.stringify(details));
  }

  return { createRun, getRun, step, getArtifact, getArtifactContent, setContext, getEvents, listSteps };
}

function persistArtifact(baseDir: string, artifactPath: string | null, preview: string | null): void {
  if (!artifactPath || !preview) return;
  const diskPath = resolve(baseDir, ".skelo", trimLeadingSlash(artifactPath));
  mkdirSync(dirname(diskPath), { recursive: true });
  writeFileSync(diskPath, preview, "utf8");
}

function trimLeadingSlash(value: string): string {
  return value.startsWith("/") ? value.slice(1) : value;
}

function evaluateGate(
  run: RunModel,
  nextBlock: BlockStep,
  input: RunStepInput,
  context: RunContext
): { name: string; pass: boolean; reason?: string; details?: Record<string, unknown> } {
  if (nextBlock === "DONE") {
    const approved = input.reviewApproved ?? context.review_approved;
    if (approved !== true) {
      return {
        name: "review-approval-required",
        pass: false,
        reason: "MARI_REVIEW -> DONE requires reviewApproved=true",
        details: {
          expected: true,
          received: approved ?? null,
        },
      };
    }
  }

  return { name: "deterministic-transition", pass: true };
}

function buildOutput(run: RunModel, block: BlockStep, context: RunContext): BlockOutput {
  const base = {
    block,
    iteration: run.iteration,
    timestamp: new Date().toISOString(),
  };

  if (block === "REI_BUILD") {
    const artifactPath = `/artifacts/${run.id}/iteration-${run.iteration}/index.html`;
    const preview = `<div style=\"padding:16px;font-family:system-ui\"><h2>OpenSkelo Artifact</h2><p>${escapeHtml(
      run.original_prompt
    )}</p></div>`;

    return {
      ...base,
      agent: "rei",
      output: `Built artifact for: ${run.original_prompt}`,
      artifact_path: artifactPath,
      artifact_preview: preview,
      context_snapshot: context,
    };
  }

  if (block === "DONE") {
    return {
      ...base,
      agent: "nora",
      output: `what else can we improve on this?\n\noriginal prompt: ${run.original_prompt}`,
      artifact_path: run.artifact_path,
      artifact_preview: run.artifact_preview,
      context_snapshot: context,
    };
  }

  if (block === "NORA_PLAN") {
    return {
      ...base,
      agent: "nora",
      output: `Plan iteration ${run.iteration} for prompt: ${run.original_prompt}`,
      artifact_path: run.artifact_path,
      artifact_preview: run.artifact_preview,
      context_snapshot: context,
    };
  }

  return {
    ...base,
    agent: "mari",
    output: `Review completed for iteration ${run.iteration}`,
    artifact_path: run.artifact_path,
    artifact_preview: run.artifact_preview,
    context_snapshot: context,
  };
}

function rowToRun(row: Record<string, unknown>): RunModel {
  return {
    id: row.id as string,
    original_prompt: row.original_prompt as string,
    current_block: row.current_block as BlockStep,
    iteration: Number(row.iteration ?? 1),
    run_version: Number(row.run_version ?? 0),
    status: (row.status as "running" | "done") ?? "running",
    artifact_path: (row.artifact_path as string | null) ?? null,
    artifact_preview: (row.artifact_preview as string | null) ?? null,
    context: safeJson(row.context as string, {}),
    blocks: safeJson(row.blocks as string, []) as BlockOutput[],
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function rowToEvent(row: Record<string, unknown>): RunEvent {
  return {
    id: row.id as string,
    run_id: row.run_id as string,
    block: row.block as BlockStep,
    transition: row.transition as string,
    result: row.result as "pass" | "fail",
    details: safeJson(row.details as string, {}),
    created_at: row.created_at as string,
  };
}

function rowToStep(row: Record<string, unknown>): RunStepRecord {
  return {
    id: row.id as string,
    run_id: row.run_id as string,
    step_index: Number(row.step_index ?? 0),
    transition: row.transition as string,
    block: row.block as BlockStep,
    iteration: Number(row.iteration ?? 1),
    agent: row.agent as "nora" | "rei" | "mari",
    output: row.output as string,
    artifact_path: (row.artifact_path as string | null) ?? null,
    artifact_preview: (row.artifact_preview as string | null) ?? null,
    context_snapshot: safeJson(row.context_snapshot as string, {}),
    timestamp: row.timestamp as string,
  };
}

function safeJson<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function hashStepRequest(input: { reviewApproved?: boolean; contextPatch?: RunContext }): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function normalizeIdempotencyKey(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
