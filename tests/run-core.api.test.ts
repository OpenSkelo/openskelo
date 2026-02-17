import { afterEach, describe, expect, it } from "vitest";
import { getDB } from "../src/core/db";
import { setupTestApp } from "./helpers/test-app";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});


function normalizeContractPayload(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value),
    (key, raw) => {
      if (typeof raw !== "string") return raw;
      if (key === "id" && raw.startsWith("RUN-")) return "RUN-<id>";
      if (key === "run_id" && raw.startsWith("RUN-")) return "RUN-<id>";
      if (key === "id") return "<id>";
      if (key === "created_at" || key === "updated_at" || key === "timestamp") return "<timestamp>";
      if (key === "artifact_path") return raw.replace(/RUN-[^/]+/g, "RUN-<id>");
      if (key === "file_path") return raw.replace(/RUN-[^/]+/g, "RUN-<id>").replace(/openskelo-test-[^/]+/g, "openskelo-test-<tmp>");
      return raw;
    }
  );
}

async function createRun(app: ReturnType<typeof setupTestApp>["app"], prompt = "Build test artifact") {
  const res = await app.request("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ original_prompt: prompt }),
  });
  expect(res.status).toBe(201);
  const data = (await res.json()) as { run: { id: string } };
  return data.run.id;
}

describe("run creation + validation", () => {
  it("creates a run at PLAN with iteration 1", async () => {
    const ctx = setupTestApp();
    cleanups.push(ctx.cleanup);

    const runId = await createRun(ctx.app, "Deterministic loop");

    const getRes = await ctx.app.request(`/api/runs/${runId}`);
    expect(getRes.status).toBe(200);
    const payload = (await getRes.json()) as {
      run: { current_block: string; iteration: number; context: Record<string, unknown>; run_version: number };
    };

    expect(payload.run.current_block).toBe("PLAN");
    expect(payload.run.iteration).toBe(1);
    expect(payload.run.run_version).toBe(0);
    expect(payload.run.context).toEqual({});
  });

  it("rejects malformed run creation payloads with 400", async () => {
    const ctx = setupTestApp();
    cleanups.push(ctx.cleanup);

    const cases = [{}, { original_prompt: "   " }, { original_prompt: "ok", context: "bad" }, "not-object"];

    for (const body of cases) {
      const res = await ctx.app.request("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
    }
  });
});

describe("deterministic transitions + gates", () => {
  it("enforces deterministic step transitions and REVIEW->DONE approval gate", async () => {
    const ctx = setupTestApp();
    cleanups.push(ctx.cleanup);
    const runId = await createRun(ctx.app);

    const first = await ctx.app.request(`/api/runs/${runId}/step`, { method: "POST", body: "{}" });
    expect(first.status).toBe(200);
    const firstData = (await first.json()) as { run: { current_block: string } };
    expect(firstData.run.current_block).toBe("EXECUTE");

    const second = await ctx.app.request(`/api/runs/${runId}/step`, { method: "POST", body: "{}" });
    expect(second.status).toBe(200);
    const secondData = (await second.json()) as { run: { current_block: string } };
    expect(secondData.run.current_block).toBe("REVIEW");

    const failReview = await ctx.app.request(`/api/runs/${runId}/step`, { method: "POST", body: "{}" });
    expect(failReview.status).toBe(400);
    const failPayload = (await failReview.json()) as { gate: { name: string }; error: string };
    expect(failPayload.error).toBe("Gate failure");
    expect(failPayload.gate.name).toBe("review-approval-required");

    const passReview = await ctx.app.request(`/api/runs/${runId}/step`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviewApproved: true }),
    });
    expect(passReview.status).toBe(200);
    const passPayload = (await passReview.json()) as { run: { current_block: string } };
    expect(passPayload.run.current_block).toBe("DONE");
  });
});

describe("idempotency + conflict semantics", () => {
  it("deduplicates retrying the same step payload with the same idempotency key", async () => {
    const ctx = setupTestApp();
    cleanups.push(ctx.cleanup);
    const runId = await createRun(ctx.app);

    const first = await ctx.app.request(`/api/runs/${runId}/step`, {
      method: "POST",
      headers: { "idempotency-key": "step-001", "content-type": "application/json" },
      body: JSON.stringify({ contextPatch: { a: 1 } }),
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { deduplicated: boolean; run: { current_block: string } };
    expect(firstBody.deduplicated).toBe(false);
    expect(firstBody.run.current_block).toBe("EXECUTE");

    const retried = await ctx.app.request(`/api/runs/${runId}/step`, {
      method: "POST",
      headers: { "idempotency-key": "step-001", "content-type": "application/json" },
      body: JSON.stringify({ contextPatch: { a: 1 } }),
    });
    expect(retried.status).toBe(200);
    const retriedBody = (await retried.json()) as { deduplicated: boolean; run: { current_block: string } };
    expect(retriedBody.deduplicated).toBe(true);
    expect(retriedBody.run.current_block).toBe("EXECUTE");

    const stepsRes = await ctx.app.request(`/api/runs/${runId}/steps`);
    const steps = ((await stepsRes.json()) as { steps: Array<{ step_index: number }> }).steps;
    expect(steps).toHaveLength(1);
  });

  it("returns 409 when an idempotency key is reused with a different payload", async () => {
    const ctx = setupTestApp();
    cleanups.push(ctx.cleanup);
    const runId = await createRun(ctx.app);

    await ctx.app.request(`/api/runs/${runId}/step`, {
      method: "POST",
      headers: { "idempotency-key": "step-002", "content-type": "application/json" },
      body: JSON.stringify({ contextPatch: { a: 1 } }),
    });

    const conflict = await ctx.app.request(`/api/runs/${runId}/step`, {
      method: "POST",
      headers: { "idempotency-key": "step-002", "content-type": "application/json" },
      body: JSON.stringify({ contextPatch: { a: 2 } }),
    });

    expect(conflict.status).toBe(409);
    const payload = (await conflict.json()) as { code: string };
    expect(payload.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("rejects mismatch between idempotency header and body field", async () => {
    const ctx = setupTestApp();
    cleanups.push(ctx.cleanup);
    const runId = await createRun(ctx.app);

    const bad = await ctx.app.request(`/api/runs/${runId}/step`, {
      method: "POST",
      headers: { "idempotency-key": "header-key", "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "body-key" }),
    });

    expect(bad.status).toBe(400);
  });
});

describe("shared context + artifacts + run_steps integrity", () => {
  it("persists shared context writes and merges context patches on step", async () => {
    const ctx = setupTestApp();
    cleanups.push(ctx.cleanup);
    const runId = await createRun(ctx.app);

    const setRes = await ctx.app.request(`/api/runs/${runId}/context`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: "TASK-777", scope: "core" }),
    });
    expect(setRes.status).toBe(200);

    const stepRes = await ctx.app.request(`/api/runs/${runId}/step`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contextPatch: { build_status: "ok" } }),
    });
    expect(stepRes.status).toBe(200);

    const getCtx = await ctx.app.request(`/api/runs/${runId}/context`);
    const body = (await getCtx.json()) as { context: Record<string, unknown> };
    expect(body.context).toEqual({ task_id: "TASK-777", scope: "core", build_status: "ok" });
  });

  it("exposes artifact metadata and persisted content endpoint after EXECUTE", async () => {
    const ctx = setupTestApp();
    cleanups.push(ctx.cleanup);
    const runId = await createRun(ctx.app, "<script>unsafe</script>");

    await ctx.app.request(`/api/runs/${runId}/step`, { method: "POST", body: "{}" });

    const metaRes = await ctx.app.request(`/api/runs/${runId}/artifact`);
    expect(metaRes.status).toBe(200);
    const meta = (await metaRes.json()) as { artifact_path: string; persisted: boolean; file_path: string };
    expect(meta.artifact_path).toContain(`/artifacts/${runId}/iteration-1/index.html`);
    expect(meta.persisted).toBe(true);
    expect(meta.file_path).toContain(".skelo");

    const contentRes = await ctx.app.request(`/api/runs/${runId}/artifact/content`);
    expect(contentRes.status).toBe(200);
    const content = await contentRes.text();
    expect(content).toContain("OpenSkelo Artifact");
    expect(content).toContain("&lt;script&gt;unsafe&lt;/script&gt;");
  });
});

describe("response contracts (snapshot lock)", () => {
  it("freezes GET /api/runs/:id response shape", async () => {
    const ctx = setupTestApp();
    cleanups.push(ctx.cleanup);
    const runId = await createRun(ctx.app, "Contract run");

    const res = await ctx.app.request(`/api/runs/${runId}`);
    const payload = (await res.json()) as Record<string, unknown>;

    expect(normalizeContractPayload(payload)).toMatchSnapshot();
  });

  it("freezes GET /api/runs/:id/steps response shape", async () => {
    const ctx = setupTestApp();
    cleanups.push(ctx.cleanup);
    const runId = await createRun(ctx.app, "Contract steps");
    await ctx.app.request(`/api/runs/${runId}/step`, { method: "POST", body: "{}" });

    const res = await ctx.app.request(`/api/runs/${runId}/steps`);
    const payload = (await res.json()) as Record<string, unknown>;

    expect(normalizeContractPayload(payload)).toMatchSnapshot();
  });

  it("freezes GET /api/runs/:id/artifact response shape", async () => {
    const ctx = setupTestApp();
    cleanups.push(ctx.cleanup);
    const runId = await createRun(ctx.app, "Contract artifact");
    await ctx.app.request(`/api/runs/${runId}/step`, { method: "POST", body: "{}" });

    const res = await ctx.app.request(`/api/runs/${runId}/artifact`);
    const payload = (await res.json()) as Record<string, unknown>;

    expect(normalizeContractPayload(payload)).toMatchSnapshot();
  });

  it("freezes GET /api/runs/:id/artifact/content response body", async () => {
    const ctx = setupTestApp();
    cleanups.push(ctx.cleanup);
    const runId = await createRun(ctx.app, "Contract artifact content");
    await ctx.app.request(`/api/runs/${runId}/step`, { method: "POST", body: "{}" });

    const res = await ctx.app.request(`/api/runs/${runId}/artifact/content`);
    expect(res.status).toBe(200);
    const content = await res.text();

    expect(normalizeContractPayload(content)).toMatchSnapshot();
  });
});

describe("integration flow and reliability edge cases", () => {
  it("completes full loop PLAN -> EXECUTE -> REVIEW -> DONE -> PLAN", async () => {
    const ctx = setupTestApp();
    cleanups.push(ctx.cleanup);
    const runId = await createRun(ctx.app);

    await ctx.app.request(`/api/runs/${runId}/step`, { method: "POST", body: "{}" });
    await ctx.app.request(`/api/runs/${runId}/step`, { method: "POST", body: "{}" });
    await ctx.app.request(`/api/runs/${runId}/step`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviewApproved: true }),
    });
    const loopRes = await ctx.app.request(`/api/runs/${runId}/step`, { method: "POST", body: "{}" });

    expect(loopRes.status).toBe(200);
    const payload = (await loopRes.json()) as { run: { current_block: string; iteration: number } };
    expect(payload.run.current_block).toBe("PLAN");
    expect(payload.run.iteration).toBe(2);
  });

  it("still allows intentional sequential non-idempotent progression", async () => {
    const ctx = setupTestApp();
    cleanups.push(ctx.cleanup);
    const runId = await createRun(ctx.app);

    const a = await ctx.app.request(`/api/runs/${runId}/step`, { method: "POST", body: "{}" });
    const b = await ctx.app.request(`/api/runs/${runId}/step`, { method: "POST", body: "{}" });

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const stepsRes = await ctx.app.request(`/api/runs/${runId}/steps`);
    const steps = ((await stepsRes.json()) as { steps: Array<{ step_index: number }> }).steps;
    expect(steps.map((s) => s.step_index)).toEqual([1, 2]);
  });

  it("returns 404 for missing run IDs and task IDs", async () => {
    const ctx = setupTestApp();
    cleanups.push(ctx.cleanup);

    const runRes = await ctx.app.request("/api/runs/RUN-missing");
    expect(runRes.status).toBe(404);

    const stepRes = await ctx.app.request("/api/runs/RUN-missing/step", { method: "POST", body: "{}" });
    expect(stepRes.status).toBe(404);

    const taskRes = await ctx.app.request("/api/tasks/TASK-404");
    expect(taskRes.status).toBe(404);
  });

  it("rejects malformed payloads for step and context APIs", async () => {
    const ctx = setupTestApp();
    cleanups.push(ctx.cleanup);
    const runId = await createRun(ctx.app);

    const badStep = await ctx.app.request(`/api/runs/${runId}/step`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviewApproved: "yes" }),
    });
    expect(badStep.status).toBe(400);

    const badCtx = await ctx.app.request(`/api/runs/${runId}/context`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(["wrong"]),
    });
    expect(badCtx.status).toBe(400);
  });

  it("returns 400 for invalid transition source state", async () => {
    const ctx = setupTestApp();
    cleanups.push(ctx.cleanup);
    const runId = await createRun(ctx.app);

    getDB().prepare("UPDATE runs SET current_block = ? WHERE id = ?").run("BROKEN_STATE", runId);

    const res = await ctx.app.request(`/api/runs/${runId}/step`, { method: "POST", body: "{}" });
    expect(res.status).toBe(400);
  });
});
