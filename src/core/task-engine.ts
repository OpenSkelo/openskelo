import { nanoid } from "nanoid";
import type { Task, Pipeline, GateResult } from "../types.js";
import { getDB } from "./db.js";

export function createTaskEngine(pipelines: Record<string, Pipeline>) {
  const db = getDB();

  // Prepared statements
  const insertStmt = db.prepare(`
    INSERT INTO tasks (id, pipeline, title, description, status, assigned, notes, metadata, priority)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateStmt = db.prepare(`
    UPDATE tasks SET status=?, assigned=?, notes=?, metadata=?, bounce_count=?, updated_at=datetime('now')
    WHERE id=?
  `);

  const getByIdStmt = db.prepare("SELECT * FROM tasks WHERE id = ?");
  const listStmt = db.prepare("SELECT * FROM tasks ORDER BY created_at DESC");
  const listByStatusStmt = db.prepare("SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC");
  const listByPipelineStmt = db.prepare("SELECT * FROM tasks WHERE pipeline = ? ORDER BY created_at DESC");

  const auditStmt = db.prepare(`
    INSERT INTO audit_log (id, task_id, from_status, to_status, agent, gates, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const gateLogStmt = db.prepare(`
    INSERT INTO gate_log (id, task_id, gate_name, transition, result, reason)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  function generateId(pipeline: string): string {
    // Count existing tasks to get next number
    const count = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE pipeline = ?").get(pipeline) as { count: number };
    const num = (count?.count ?? 0) + 1;
    return `TASK-${String(num).padStart(3, "0")}`;
  }

  function create(opts: {
    pipeline: string;
    title: string;
    description?: string;
    assigned?: string;
    priority?: string;
    metadata?: Record<string, unknown>;
  }): Task {
    // Validate pipeline exists
    if (!pipelines[opts.pipeline]) {
      throw new Error(`Unknown pipeline: '${opts.pipeline}'. Available: ${Object.keys(pipelines).join(", ")}`);
    }

    const id = generateId(opts.pipeline);
    const initialStatus = pipelines[opts.pipeline].stages[0]?.name ?? "PENDING";

    insertStmt.run(
      id,
      opts.pipeline,
      opts.title,
      opts.description ?? "",
      initialStatus,
      opts.assigned ?? "",
      "",
      JSON.stringify(opts.metadata ?? {}),
      opts.priority ?? "P2"
    );

    return getById(id)!;
  }

  function getById(id: string): Task | null {
    const row = getByIdStmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return rowToTask(row);
  }

  function list(filter?: { status?: string; pipeline?: string }): Task[] {
    let rows: Record<string, unknown>[];
    if (filter?.status) {
      rows = listByStatusStmt.all(filter.status) as Record<string, unknown>[];
    } else if (filter?.pipeline) {
      rows = listByPipelineStmt.all(filter.pipeline) as Record<string, unknown>[];
    } else {
      rows = listStmt.all() as Record<string, unknown>[];
    }
    return rows.map(rowToTask);
  }

  function transition(
    taskId: string,
    toStatus: string,
    updates: { assigned?: string; notes?: string; metadata?: Record<string, unknown> },
    agent: string,
    gateResults: GateResult[]
  ): Task {
    const task = getById(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    const pipeline = pipelines[task.pipeline];
    if (!pipeline) throw new Error(`Pipeline '${task.pipeline}' not found`);

    // Validate transition is allowed
    const currentStage = pipeline.stages.find((s) => s.name === task.status);
    if (!currentStage) throw new Error(`Task ${taskId} is in unknown status '${task.status}'`);

    if (currentStage.transitions && !currentStage.transitions.includes(toStatus)) {
      throw new Error(
        `Invalid transition: ${task.status} → ${toStatus}. Allowed: ${currentStage.transitions.join(", ")}`
      );
    }

    // Track bounces
    let bounceCount = task.bounce_count;
    if (toStatus === "IN_PROGRESS" && task.status === "REVIEW") {
      bounceCount++;
    } else if (toStatus === "DONE") {
      bounceCount = 0;
    }

    // Update task
    const newNotes = updates.notes ?? task.notes;
    const newAssigned = updates.assigned ?? task.assigned;
    const newMetadata = updates.metadata
      ? JSON.stringify({ ...task.metadata, ...updates.metadata })
      : JSON.stringify(task.metadata);

    updateStmt.run(toStatus, newAssigned, newNotes, newMetadata, bounceCount, taskId);

    // Audit log
    auditStmt.run(
      nanoid(),
      taskId,
      task.status,
      toStatus,
      agent,
      JSON.stringify(gateResults),
      newNotes
    );

    // Gate log
    for (const result of gateResults) {
      gateLogStmt.run(
        nanoid(),
        taskId,
        result.name,
        `${task.status}→${toStatus}`,
        result.result,
        result.reason ?? null
      );
    }

    return getById(taskId)!;
  }

  function counts(): Record<string, number> {
    const rows = db.prepare(
      "SELECT status, COUNT(*) as count FROM tasks GROUP BY status"
    ).all() as Array<{ status: string; count: number }>;

    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.status] = row.count;
    }
    return result;
  }

  return { create, getById, list, transition, counts, generateId };
}

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    pipeline: row.pipeline as string,
    title: row.title as string,
    description: (row.description as string) ?? "",
    status: row.status as string,
    assigned: (row.assigned as string) ?? "",
    notes: (row.notes as string) ?? "",
    metadata: safeJsonParse(row.metadata as string, {}),
    bounce_count: (row.bounce_count as number) ?? 0,
    priority: (row.priority as string) ?? "P2",
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function safeJsonParse(str: string, fallback: Record<string, unknown>): Record<string, unknown> {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
