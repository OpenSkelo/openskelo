import type Database from 'better-sqlite3'
import type { TemplateStore } from './templates.js'

export interface ScheduleConfig {
  template: string
  every: string
  enabled?: boolean
}

export interface ScheduleEntry {
  template: string
  interval_ms: number
  enabled: boolean
  last_run_at?: string
  next_run_at?: string
}

const SCHEDULE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS schedules (
    template_name TEXT PRIMARY KEY,
    last_run_at TEXT,
    next_run_at TEXT
  )
`

const DURATION_RE = /^(\d+)(m|h|d)$/

export function parseDuration(input: string): number {
  const match = DURATION_RE.exec(input)
  if (!match) {
    throw new Error(`Invalid duration: "${input}". Use format like "30m", "1h", "6h", "24h", "7d"`)
  }

  const value = parseInt(match[1], 10)
  const unit = match[2]

  switch (unit) {
    case 'm': return value * 60 * 1000
    case 'h': return value * 60 * 60 * 1000
    case 'd': return value * 24 * 60 * 60 * 1000
    default: throw new Error(`Unknown duration unit: ${unit}`)
  }
}

function ensureScheduleTable(db: Database.Database): void {
  db.exec(SCHEDULE_SCHEMA)
}

export class Scheduler {
  private templateStore: TemplateStore
  private db: Database.Database
  private entries: ScheduleEntry[]
  private timers: ReturnType<typeof setTimeout>[] = []
  private intervals: ReturnType<typeof setInterval>[] = []

  constructor(templateStore: TemplateStore, db: Database.Database, schedules: ScheduleConfig[]) {
    this.templateStore = templateStore
    this.db = db
    ensureScheduleTable(db)

    this.entries = schedules.map(s => ({
      template: s.template,
      interval_ms: parseDuration(s.every),
      enabled: s.enabled !== false,
    }))

    // Load persisted last_run_at
    for (const entry of this.entries) {
      const row = this.db.prepare('SELECT last_run_at, next_run_at FROM schedules WHERE template_name = ?')
        .get(entry.template) as { last_run_at: string | null; next_run_at: string | null } | undefined
      if (row) {
        entry.last_run_at = row.last_run_at ?? undefined
        entry.next_run_at = row.next_run_at ?? undefined
      }
    }
  }

  start(): void {
    const now = Date.now()

    for (const entry of this.entries) {
      if (!entry.enabled) continue

      const lastRun = entry.last_run_at ? new Date(entry.last_run_at).getTime() : 0
      const nextRun = entry.next_run_at ? new Date(entry.next_run_at).getTime() : 0
      const overdue = nextRun > 0 && nextRun <= now

      if (overdue || lastRun === 0) {
        // Trigger immediately, then start interval
        this.trigger(entry)
        const interval = setInterval(() => this.trigger(entry), entry.interval_ms)
        this.intervals.push(interval)
      } else {
        // Wait for remaining time, then start interval
        const remaining = nextRun - now
        const timer = setTimeout(() => {
          this.trigger(entry)
          const interval = setInterval(() => this.trigger(entry), entry.interval_ms)
          this.intervals.push(interval)
        }, remaining)
        this.timers.push(timer)
      }
    }
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer)
    for (const interval of this.intervals) clearInterval(interval)
    this.timers = []
    this.intervals = []
  }

  getStatus(): ScheduleEntry[] {
    return this.entries.map(e => ({ ...e }))
  }

  private trigger(entry: ScheduleEntry): void {
    const now = new Date()

    try {
      this.templateStore.instantiate(entry.template)
      console.log(`Scheduler: triggered template '${entry.template}'`)
    } catch (err) {
      console.error(`Scheduler: failed to trigger template '${entry.template}':`, (err as Error).message)
    }

    entry.last_run_at = now.toISOString()
    entry.next_run_at = new Date(now.getTime() + entry.interval_ms).toISOString()

    this.db.prepare(`
      INSERT INTO schedules (template_name, last_run_at, next_run_at)
      VALUES (?, ?, ?)
      ON CONFLICT(template_name) DO UPDATE SET last_run_at = excluded.last_run_at, next_run_at = excluded.next_run_at
    `).run(entry.template, entry.last_run_at, entry.next_run_at)
  }
}
