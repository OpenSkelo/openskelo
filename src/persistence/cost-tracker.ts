import type Database from "better-sqlite3";

export interface CostEvent {
  agentId: string;
  runId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  timestamp?: string;
}

export class CostTracker {
  constructor(private db: Database.Database) {
    this.ensureTable();
  }

  ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cost_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cost_usd REAL NOT NULL,
        duration_ms INTEGER NOT NULL,
        timestamp TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_cost_agent_day ON cost_events(agent_id, timestamp);
    `);
  }

  async record(event: CostEvent): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO cost_events (
        agent_id, run_id, model, input_tokens, output_tokens, cost_usd, duration_ms, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
    `);

    stmt.run(
      event.agentId,
      event.runId,
      event.model,
      event.inputTokens,
      event.outputTokens,
      event.costUsd,
      event.durationMs,
      event.timestamp ?? null
    );
  }

  async agentTotal(agentId: string): Promise<number> {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(cost_usd), 0) as total FROM cost_events WHERE agent_id = ?")
      .get(agentId) as { total: number };
    return Number(row?.total ?? 0);
  }

  async dailyTotal(agentId: string): Promise<number> {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(cost_usd), 0) as total FROM cost_events WHERE agent_id = ? AND date(timestamp) = date('now')")
      .get(agentId) as { total: number };
    return Number(row?.total ?? 0);
  }

  async monthlyTotal(): Promise<number> {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(cost_usd), 0) as total FROM cost_events WHERE strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')")
      .get() as { total: number };
    return Number(row?.total ?? 0);
  }
}
