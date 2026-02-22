import type Database from 'better-sqlite3'
import { ulid } from './id.js'

const LESSONS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS lessons (
    id TEXT PRIMARY KEY,
    rule TEXT NOT NULL,
    category TEXT NOT NULL,
    source_task_id TEXT,
    source_fix_id TEXT,
    severity TEXT DEFAULT 'medium',
    created_at TEXT NOT NULL,
    times_applied INTEGER DEFAULT 0
  )
`

export interface Lesson {
  id: string
  rule: string
  category: string
  source_task_id: string | null
  source_fix_id: string | null
  severity: string
  created_at: string
  times_applied: number
}

export interface CreateLessonInput {
  rule: string
  category: string
  source_task_id?: string
  source_fix_id?: string
  severity?: string
}

const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low'])

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

function normalizeSeverity(severity?: string): string {
  const value = String(severity ?? 'medium').toLowerCase().trim()
  return VALID_SEVERITIES.has(value) ? value : 'medium'
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can', 'it', 'its', 'this',
  'that', 'these', 'those', 'not', 'no', 'all', 'each', 'every', 'any',
])

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
}

export function parseLessonOutput(output: string): CreateLessonInput | null {
  const jsonMatch = output.match(/```(?:json)?\s*([\s\S]*?)```/)
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : output.trim()

  try {
    const parsed = JSON.parse(jsonStr)
    const rule = typeof parsed.rule === 'string' ? parsed.rule.trim() : ''
    const category = typeof parsed.category === 'string' ? parsed.category.trim() : ''
    if (rule && category) {
      return {
        rule,
        category,
        severity: normalizeSeverity(parsed.severity),
      }
    }
  } catch {
    // Fall through
  }

  return null
}

export function buildLessonPrompt(
  parent: { summary: string; prompt: string; result: string | null },
  fix: { result: string | null },
  findings: unknown[],
): string {
  return [
    'You are extracting a reusable engineering lesson from a review/fix cycle.',
    '',
    '## Original Task',
    `Summary: ${parent.summary}`,
    `Prompt: ${parent.prompt}`,
    '',
    '## Original Output (had issues)',
    parent.result ?? '(no result)',
    '',
    '## Review Findings',
    JSON.stringify(findings, null, 2),
    '',
    '## Fix Applied',
    fix.result ?? '(no result)',
    '',
    '## Instructions',
    'Extract ONE concise, actionable rule that would prevent this type of mistake.',
    'The rule should be general enough to apply to future tasks, not specific to this file.',
    '',
    'Respond with ONLY a JSON object:',
    '{',
    '  "rule": "Always [do X] when [condition], because [reason]",',
    '  "category": "security|error-handling|testing|performance|architecture|validation|concurrency",',
    '  "severity": "critical|high|medium|low"',
    '}',
  ].join('\n')
}

export class LessonStore {
  private db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
    this.db.exec(LESSONS_SCHEMA)
  }

  create(input: CreateLessonInput): Lesson {
    const rule = String(input.rule ?? '').trim()
    const category = String(input.category ?? '').trim()
    if (!rule || !category) {
      throw new Error('rule and category are required')
    }

    if (input.severity && !VALID_SEVERITIES.has(String(input.severity).toLowerCase())) {
      throw new Error(`Invalid lesson severity: ${input.severity}`)
    }

    const id = ulid()
    const now = new Date().toISOString()

    this.db.prepare(`
      INSERT INTO lessons (id, rule, category, source_task_id, source_fix_id, severity, created_at, times_applied)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      id,
      rule,
      category,
      input.source_task_id ?? null,
      input.source_fix_id ?? null,
      normalizeSeverity(input.severity),
      now,
    )

    return this.getById(id)!
  }

  getById(id: string): Lesson | null {
    const row = this.db.prepare('SELECT * FROM lessons WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!row) return null
    return this.deserialize(row)
  }

  list(filters?: { category?: string; limit?: number }): Lesson[] {
    const conditions: string[] = []
    const params: unknown[] = []

    if (filters?.category) {
      conditions.push('category = ?')
      params.push(filters.category)
    }

    let sql = 'SELECT * FROM lessons'
    if (conditions.length) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }
    sql += ' ORDER BY times_applied DESC, created_at DESC'

    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
    }

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[]
    return rows.map(row => this.deserialize(row))
  }

  search(keywords: string): Lesson[] {
    const words = keywords.toLowerCase().split(/\s+/).filter(w => w.length > 0)
    if (words.length === 0) return []

    const conditions = words.map(() => 'LOWER(rule) LIKE ?')
    const params = words.map(w => `%${w}%`)

    const sql = `SELECT * FROM lessons WHERE ${conditions.join(' OR ')} ORDER BY times_applied DESC`
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[]
    return rows.map(row => this.deserialize(row))
  }

  incrementApplied(id: string): void {
    this.db.prepare(
      'UPDATE lessons SET times_applied = times_applied + 1 WHERE id = ?',
    ).run(id)
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM lessons WHERE id = ?').run(id)
    return result.changes > 0
  }

  getRelevant(taskPrompt: string, limit = 5): Lesson[] {
    const keywords = extractKeywords(taskPrompt)
    if (keywords.length === 0) return this.list({ limit })

    const allLessons = this.list()
    if (allLessons.length === 0) return []

    const scored = allLessons.map(lesson => {
      const ruleLower = lesson.rule.toLowerCase()
      let matchCount = 0
      for (const kw of keywords) {
        if (ruleLower.includes(kw)) matchCount++
      }
      const severityWeight = SEVERITY_WEIGHT[lesson.severity] ?? 2
      const appliedBoost = Math.min(lesson.times_applied, 10)
      const score = matchCount * 10 + severityWeight * 3 + appliedBoost
      return { lesson, score, matchCount }
    })

    return scored
      .filter(s => s.matchCount > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.lesson)
  }

  private deserialize(row: Record<string, unknown>): Lesson {
    return {
      id: row.id as string,
      rule: row.rule as string,
      category: row.category as string,
      source_task_id: (row.source_task_id as string) ?? null,
      source_fix_id: (row.source_fix_id as string) ?? null,
      severity: (row.severity as string) ?? 'medium',
      created_at: row.created_at as string,
      times_applied: (row.times_applied as number) ?? 0,
    }
  }
}
