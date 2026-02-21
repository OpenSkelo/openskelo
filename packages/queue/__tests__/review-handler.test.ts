import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createDatabase } from '../src/db.js'
import { TaskStore } from '../src/task-store.js'
import type { Task, CreateTaskInput } from '../src/task-store.js'
import { AuditLog } from '../src/audit.js'
import { TaskStatus } from '../src/state-machine.js'
import { WebhookDispatcher } from '../src/webhooks.js'
import {
  ReviewHandler,
  buildReviewPrompt,
  buildMergePrompt,
  buildFixPrompt,
  parseReviewDecision,
} from '../src/review-handler.js'
import type { AutoReviewConfig, ReviewDecision } from '../src/review-handler.js'

function makeTaskInput(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
  return {
    type: 'coding',
    summary: 'Implement feature X',
    prompt: 'Write the code for feature X',
    backend: 'claude-code',
    ...overrides,
  }
}

function makeAutoReviewConfig(overrides: Partial<AutoReviewConfig> = {}): AutoReviewConfig {
  return {
    reviewers: [
      { backend: 'openrouter', model: 'anthropic/claude-sonnet-4-5-20250929' },
    ],
    strategy: 'all_must_approve',
    ...overrides,
  }
}

describe('parseReviewDecision', () => {
  it('parses valid JSON approval', () => {
    const output = JSON.stringify({ approved: true, reasoning: 'Looks good' })
    const decision = parseReviewDecision(output)
    expect(decision.approved).toBe(true)
    expect(decision.reasoning).toBe('Looks good')
    expect(decision.feedback).toBeUndefined()
  })

  it('parses valid JSON rejection with feedback', () => {
    const output = JSON.stringify({
      approved: false,
      reasoning: 'Missing error handling',
      feedback: { what: 'no try/catch', where: 'api.ts:42', fix: 'wrap in try/catch' },
    })
    const decision = parseReviewDecision(output)
    expect(decision.approved).toBe(false)
    expect(decision.feedback).toEqual({
      what: 'no try/catch',
      where: 'api.ts:42',
      fix: 'wrap in try/catch',
    })
  })

  it('parses JSON inside code fences', () => {
    const output = 'Here is my review:\n```json\n{"approved": true, "reasoning": "All good"}\n```'
    const decision = parseReviewDecision(output)
    expect(decision.approved).toBe(true)
    expect(decision.reasoning).toBe('All good')
  })

  it('falls back to heuristic for "approved"', () => {
    const decision = parseReviewDecision('The code looks good and is approved.')
    expect(decision.approved).toBe(true)
  })

  it('does not treat "not approved" as approval', () => {
    const decision = parseReviewDecision('This is not approved yet. Needs changes.')
    expect(decision.approved).toBe(false)
  })

  it('falls back to heuristic for "lgtm"', () => {
    const decision = parseReviewDecision('LGTM, ship it!')
    expect(decision.approved).toBe(true)
  })

  it('defaults to rejection for unparseable output', () => {
    const decision = parseReviewDecision('I have concerns about this code.')
    expect(decision.approved).toBe(false)
    expect(decision.feedback).toBeDefined()
  })

  it('handles empty string', () => {
    const decision = parseReviewDecision('')
    expect(decision.approved).toBe(false)
  })
})

describe('buildReviewPrompt', () => {
  it('builds default review prompt with task details', () => {
    const task = {
      summary: 'Fix login bug',
      prompt: 'Fix the login flow',
      result: 'Fixed by updating auth middleware',
      acceptance_criteria: ['Login works', 'Tests pass'],
      definition_of_done: ['No regressions'],
    } as Task

    const prompt = buildReviewPrompt(task, { backend: 'openrouter' })
    expect(prompt).toContain('Fix login bug')
    expect(prompt).toContain('Fix the login flow')
    expect(prompt).toContain('Fixed by updating auth middleware')
    expect(prompt).toContain('Login works')
    expect(prompt).toContain('No regressions')
    expect(prompt).toContain('"approved"')
  })

  it('uses custom prompt template with placeholders', () => {
    const task = {
      summary: 'My task',
      prompt: 'Do thing',
      result: 'Done thing',
      acceptance_criteria: ['AC1'],
      definition_of_done: [],
    } as Task

    const prompt = buildReviewPrompt(task, {
      backend: 'openrouter',
      prompt_template: 'Review: {{summary}} | {{result}}',
    })
    expect(prompt).toBe('Review: My task | Done thing')
  })

  it('handles null result gracefully', () => {
    const task = {
      summary: 'Task',
      prompt: 'Do it',
      result: null,
      acceptance_criteria: [],
      definition_of_done: [],
    } as Task

    const prompt = buildReviewPrompt(task, { backend: 'openrouter' })
    expect(prompt).toContain('(no result)')
  })
})

describe('buildMergePrompt', () => {
  it('includes all reviewer decisions', () => {
    const task = {
      summary: 'Feature X',
      result: 'Implementation',
    } as Task

    const decisions: Array<{ reviewer: string; decision: ReviewDecision }> = [
      { reviewer: 'reviewer-1', decision: { approved: true, reasoning: 'Good' } },
      { reviewer: 'reviewer-2', decision: { approved: false, reasoning: 'Bad', feedback: { what: 'bug', where: 'here', fix: 'this' } } },
    ]

    const prompt = buildMergePrompt(task, decisions)
    expect(prompt).toContain('Feature X')
    expect(prompt).toContain('reviewer-1')
    expect(prompt).toContain('reviewer-2')
    expect(prompt).toContain('Good')
    expect(prompt).toContain('Bad')
    expect(prompt).toContain('bug')
  })
})

describe('buildFixPrompt', () => {
  it('includes original prompt, result, and review findings', () => {
    const task = {
      summary: 'Build auth',
      prompt: 'Implement OAuth flow',
      result: 'Added basic auth',
    } as Task

    const prompt = buildFixPrompt(task, 'Missing OAuth scopes', [])
    expect(prompt).toContain('Build auth')
    expect(prompt).toContain('Implement OAuth flow')
    expect(prompt).toContain('Added basic auth')
    expect(prompt).toContain('Missing OAuth scopes')
    expect(prompt).toContain('Fix ALL issues')
  })

  it('includes all issue fields (severity, description, location, fix)', () => {
    const task = {
      summary: 'Task',
      prompt: 'Do it',
      result: 'Done',
    } as Task

    const issues = [
      { severity: 'critical', description: 'SQL injection', location: 'api.ts:42', fix: 'Use parameterized queries' },
      { severity: 'minor', description: 'Typo', location: 'readme.md:1', fix: 'Fix spelling' },
    ]

    const prompt = buildFixPrompt(task, '', issues)
    expect(prompt).toContain('[critical] SQL injection (api.ts:42)')
    expect(prompt).toContain('Use parameterized queries')
    expect(prompt).toContain('[minor] Typo (readme.md:1)')
    expect(prompt).toContain('Fix spelling')
  })

  it('handles feedback-style issues (what, where, fix)', () => {
    const task = { summary: 'T', prompt: 'P', result: 'R' } as Task
    const issues = [
      { what: 'missing tests', where: 'src/auth.ts', fix: 'add unit tests' },
    ]
    const prompt = buildFixPrompt(task, '', issues)
    expect(prompt).toContain('missing tests')
    expect(prompt).toContain('src/auth.ts')
    expect(prompt).toContain('add unit tests')
  })

  it('handles null result gracefully', () => {
    const task = { summary: 'T', prompt: 'P', result: null } as Task
    const prompt = buildFixPrompt(task, 'issues', [])
    expect(prompt).toContain('(no result)')
  })
})

describe('ReviewHandler', () => {
  let db: ReturnType<typeof createDatabase>
  let taskStore: TaskStore
  let auditLog: AuditLog
  let handler: ReviewHandler

  beforeEach(() => {
    db = createDatabase(':memory:')
    taskStore = new TaskStore(db)
    auditLog = new AuditLog(db)
    handler = new ReviewHandler(taskStore, auditLog)
  })

  function createAndTransitionToReview(
    input: Partial<CreateTaskInput> = {},
  ): Task {
    const task = taskStore.create(makeTaskInput(input))
    taskStore.transition(task.id, TaskStatus.IN_PROGRESS, {
      lease_owner: 'worker-1',
      lease_expires_at: new Date(Date.now() + 60000).toISOString(),
    })
    return taskStore.transition(task.id, TaskStatus.REVIEW, {
      result: 'Task output here',
    })
  }

  function completeReviewChild(childId: string, result: string) {
    taskStore.transition(childId, TaskStatus.IN_PROGRESS, {
      lease_owner: 'w',
      lease_expires_at: new Date(Date.now() + 60000).toISOString(),
    })
    taskStore.transition(childId, TaskStatus.REVIEW, { result })
    handler.onTaskReview(taskStore.getById(childId)!)
  }

  describe('onTaskReview', () => {
    it('creates review child tasks for each reviewer', () => {
      const config = makeAutoReviewConfig({
        reviewers: [
          { backend: 'openrouter', model: 'anthropic/claude-sonnet-4-5-20250929' },
          { backend: 'openrouter', model: 'google/gemini-2.0-flash' },
        ],
      })
      const task = createAndTransitionToReview({
        auto_review: config as unknown as Record<string, unknown>,
      })

      handler.onTaskReview(task)

      const children = taskStore.list({ type: 'review' })
      expect(children).toHaveLength(2)
      expect(children[0].parent_task_id).toBe(task.id)
      expect(children[1].parent_task_id).toBe(task.id)
      expect(children[0].backend).toBe('openrouter/anthropic/claude-sonnet-4-5-20250929')
      expect(children[1].backend).toBe('openrouter/google/gemini-2.0-flash')
    })

    it('does nothing if no auto_review config', () => {
      const task = createAndTransitionToReview()
      handler.onTaskReview(task)

      const children = taskStore.list({ type: 'review' })
      expect(children).toHaveLength(0)
    })

    it('auto-approves review child tasks at REVIEW', () => {
      const config = makeAutoReviewConfig()
      const parentTask = createAndTransitionToReview({
        auto_review: config as unknown as Record<string, unknown>,
      })

      handler.onTaskReview(parentTask)

      const children = taskStore.list({ type: 'review' })
      expect(children).toHaveLength(1)

      const child = children[0]
      completeReviewChild(child.id, '{"approved": true, "reasoning": "LGTM"}')

      const updatedChild = taskStore.getById(child.id)!
      expect(updatedChild.status).toBe(TaskStatus.DONE)
    })

    it('logs auto_review_started audit entry', () => {
      const config = makeAutoReviewConfig()
      const task = createAndTransitionToReview({
        auto_review: config as unknown as Record<string, unknown>,
      })

      handler.onTaskReview(task)

      const logs = auditLog.getTaskHistory(task.id)
      const startLog = logs.find(l => l.action === 'auto_review_started')
      expect(startLog).toBeDefined()
      expect(startLog!.metadata).toMatchObject({
        strategy: 'all_must_approve',
        reviewer_count: 1,
      })
    })
  })

  describe('onReviewChildComplete — all_must_approve', () => {
    it('approves parent when all reviewers approve', () => {
      const config = makeAutoReviewConfig({
        reviewers: [
          { backend: 'openrouter', model: 'model-a' },
          { backend: 'openrouter', model: 'model-b' },
        ],
        strategy: 'all_must_approve',
      })

      const parent = createAndTransitionToReview({
        auto_review: config as unknown as Record<string, unknown>,
      })
      handler.onTaskReview(parent)

      const children = taskStore.list({ type: 'review' })
        .filter(t => t.parent_task_id === parent.id && !t.metadata?.is_merge)

      for (const child of children) {
        completeReviewChild(child.id, '{"approved": true, "reasoning": "good"}')
      }

      const lastChild = taskStore.getById(children[children.length - 1].id)!
      handler.onReviewChildComplete(lastChild)

      const updatedParent = taskStore.getById(parent.id)!
      expect(updatedParent.status).toBe(TaskStatus.DONE)
    })

    it('creates fix task when any reviewer rejects', () => {
      const config = makeAutoReviewConfig({
        reviewers: [
          { backend: 'openrouter', model: 'model-a' },
          { backend: 'openrouter', model: 'model-b' },
        ],
        strategy: 'all_must_approve',
      })

      const parent = createAndTransitionToReview({
        auto_review: config as unknown as Record<string, unknown>,
      })
      handler.onTaskReview(parent)

      const children = taskStore.list({ type: 'review' })
        .filter(t => t.parent_task_id === parent.id)

      // First child approves
      completeReviewChild(children[0].id, '{"approved": true}')

      // Second child rejects
      completeReviewChild(
        children[1].id,
        '{"approved": false, "reasoning": "bad", "feedback": {"what": "bug", "where": "here", "fix": "that"}}',
      )

      handler.onReviewChildComplete(taskStore.getById(children[1].id)!)

      // Parent stays in REVIEW
      const updatedParent = taskStore.getById(parent.id)!
      expect(updatedParent.status).toBe(TaskStatus.REVIEW)
      expect(updatedParent.loop_iteration).toBe(1)

      // Fix task was created
      const fixTasks = taskStore.list({})
        .filter(t => t.metadata?.fix_for === parent.id)
      expect(fixTasks).toHaveLength(1)
      expect(fixTasks[0].priority).toBe(-10)
      expect(fixTasks[0].summary).toContain('Fix:')
      expect(fixTasks[0].parent_task_id).toBe(parent.id)
    })
  })

  describe('onReviewChildComplete — any_approve', () => {
    it('approves parent when at least one reviewer approves', () => {
      const config = makeAutoReviewConfig({
        reviewers: [
          { backend: 'openrouter', model: 'model-a' },
          { backend: 'openrouter', model: 'model-b' },
        ],
        strategy: 'any_approve',
      })

      const parent = createAndTransitionToReview({
        auto_review: config as unknown as Record<string, unknown>,
      })
      handler.onTaskReview(parent)

      const children = taskStore.list({ type: 'review' })
        .filter(t => t.parent_task_id === parent.id)

      // First rejects, second approves
      completeReviewChild(
        children[0].id,
        '{"approved": false, "reasoning": "nope", "feedback": {"what": "x", "where": "y", "fix": "z"}}',
      )
      completeReviewChild(children[1].id, '{"approved": true, "reasoning": "good"}')

      handler.onReviewChildComplete(taskStore.getById(children[1].id)!)

      const updatedParent = taskStore.getById(parent.id)!
      expect(updatedParent.status).toBe(TaskStatus.DONE)
    })

    it('creates fix task when no reviewers approve', () => {
      const config = makeAutoReviewConfig({
        reviewers: [{ backend: 'openrouter', model: 'model-a' }],
        strategy: 'any_approve',
      })

      const parent = createAndTransitionToReview({
        auto_review: config as unknown as Record<string, unknown>,
      })
      handler.onTaskReview(parent)

      const children = taskStore.list({ type: 'review' })
        .filter(t => t.parent_task_id === parent.id)

      completeReviewChild(
        children[0].id,
        '{"approved": false, "feedback": {"what": "x", "where": "y", "fix": "z"}}',
      )

      handler.onReviewChildComplete(taskStore.getById(children[0].id)!)

      const updatedParent = taskStore.getById(parent.id)!
      expect(updatedParent.status).toBe(TaskStatus.REVIEW)

      const fixTasks = taskStore.list({}).filter(t => t.metadata?.fix_for === parent.id)
      expect(fixTasks).toHaveLength(1)
    })
  })

  describe('onReviewChildComplete — merge_then_decide', () => {
    it('creates merge task when all reviewers done', () => {
      const config = makeAutoReviewConfig({
        reviewers: [
          { backend: 'openrouter', model: 'model-a' },
          { backend: 'openrouter', model: 'model-b' },
        ],
        strategy: 'merge_then_decide',
        merge_backend: 'openrouter',
      })

      const parent = createAndTransitionToReview({
        auto_review: config as unknown as Record<string, unknown>,
      })
      handler.onTaskReview(parent)

      const children = taskStore.list({ type: 'review' })
        .filter(t => t.parent_task_id === parent.id && !t.metadata?.is_merge)

      for (const child of children) {
        completeReviewChild(child.id, '{"approved": true, "reasoning": "fine"}')
      }

      handler.onReviewChildComplete(taskStore.getById(children[1].id)!)

      const allReviewTasks = taskStore.list({ type: 'review' })
      const mergeTasks = allReviewTasks.filter(t => t.metadata?.is_merge)
      expect(mergeTasks).toHaveLength(1)
      expect(mergeTasks[0].parent_task_id).toBe(parent.id)
      expect(mergeTasks[0].summary).toContain('Merge review')
    })

    it('approves parent when merge task approves', () => {
      const config = makeAutoReviewConfig({
        reviewers: [{ backend: 'openrouter', model: 'model-a' }],
        strategy: 'merge_then_decide',
      })

      const parent = createAndTransitionToReview({
        auto_review: config as unknown as Record<string, unknown>,
      })
      handler.onTaskReview(parent)

      const children = taskStore.list({ type: 'review' })
        .filter(t => t.parent_task_id === parent.id && !t.metadata?.is_merge)

      completeReviewChild(children[0].id, '{"approved": true}')
      handler.onReviewChildComplete(taskStore.getById(children[0].id)!)

      const mergeTasks = taskStore.list({ type: 'review' })
        .filter(t => t.metadata?.is_merge && t.parent_task_id === parent.id)
      expect(mergeTasks).toHaveLength(1)

      completeReviewChild(mergeTasks[0].id, '{"approved": true, "reasoning": "all good"}')
      handler.onReviewChildComplete(taskStore.getById(mergeTasks[0].id)!)

      const updatedParent = taskStore.getById(parent.id)!
      expect(updatedParent.status).toBe(TaskStatus.DONE)
    })

    it('creates fix task when merge rejects', () => {
      const config = makeAutoReviewConfig({
        reviewers: [{ backend: 'openrouter', model: 'model-a' }],
        strategy: 'merge_then_decide',
      })

      const parent = createAndTransitionToReview({
        auto_review: config as unknown as Record<string, unknown>,
      })
      handler.onTaskReview(parent)

      const children = taskStore.list({ type: 'review' })
        .filter(t => t.parent_task_id === parent.id && !t.metadata?.is_merge)

      completeReviewChild(children[0].id, '{"approved": true}')
      handler.onReviewChildComplete(taskStore.getById(children[0].id)!)

      const mergeTasks = taskStore.list({ type: 'review' })
        .filter(t => t.metadata?.is_merge && t.parent_task_id === parent.id)

      completeReviewChild(
        mergeTasks[0].id,
        '{"approved": false, "reasoning": "needs work", "feedback": {"what": "incomplete", "where": "api", "fix": "add tests"}}',
      )
      handler.onReviewChildComplete(taskStore.getById(mergeTasks[0].id)!)

      const updatedParent = taskStore.getById(parent.id)!
      expect(updatedParent.status).toBe(TaskStatus.REVIEW)

      const fixTasks = taskStore.list({}).filter(t => t.metadata?.fix_for === parent.id)
      expect(fixTasks).toHaveLength(1)
    })
  })

  describe('fix task creation', () => {
    it('creates fix task with boosted priority (-10)', () => {
      const config = makeAutoReviewConfig({
        reviewers: [{ backend: 'openrouter', model: 'model-a' }],
      })

      const parent = createAndTransitionToReview({
        auto_review: config as unknown as Record<string, unknown>,
      })
      handler.onTaskReview(parent)

      const children = taskStore.list({ type: 'review' })
        .filter(t => t.parent_task_id === parent.id)

      completeReviewChild(
        children[0].id,
        '{"approved": false, "feedback": {"what": "bug", "where": "here", "fix": "that"}}',
      )
      handler.onReviewChildComplete(taskStore.getById(children[0].id)!)

      const fixTasks = taskStore.list({}).filter(t => t.metadata?.fix_for === parent.id)
      expect(fixTasks).toHaveLength(1)
      expect(fixTasks[0].priority).toBe(-10)
    })

    it('wires inject_before to downstream dependency', () => {
      const config = makeAutoReviewConfig({
        reviewers: [{ backend: 'openrouter', model: 'model-a' }],
      })

      // Create a pipeline: parent → downstream
      const parent = taskStore.create(makeTaskInput({
        auto_review: config as unknown as Record<string, unknown>,
        pipeline_id: 'pl-1',
        pipeline_step: 0,
      }))
      const downstream = taskStore.create(makeTaskInput({
        summary: 'Downstream task',
        pipeline_id: 'pl-1',
        pipeline_step: 1,
        depends_on: [parent.id],
      }))

      // Move parent to REVIEW
      taskStore.transition(parent.id, TaskStatus.IN_PROGRESS, {
        lease_owner: 'w',
        lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      })
      taskStore.transition(parent.id, TaskStatus.REVIEW, { result: 'output' })
      const parentInReview = taskStore.getById(parent.id)!

      handler.onTaskReview(parentInReview)

      const children = taskStore.list({ type: 'review' })
        .filter(t => t.parent_task_id === parent.id)

      completeReviewChild(
        children[0].id,
        '{"approved": false, "feedback": {"what": "x", "where": "y", "fix": "z"}}',
      )
      handler.onReviewChildComplete(taskStore.getById(children[0].id)!)

      // Fix task should be injected before downstream
      const fixTasks = taskStore.list({}).filter(t => t.metadata?.fix_for === parent.id)
      expect(fixTasks).toHaveLength(1)

      // Downstream should now depend on the fix task
      const updatedDownstream = taskStore.getById(downstream.id)!
      expect(updatedDownstream.depends_on).toContain(fixTasks[0].id)
    })

    it('rewires all downstream dependents in the same pipeline', () => {
      const config = makeAutoReviewConfig({
        reviewers: [{ backend: 'openrouter', model: 'model-a' }],
      })

      const parent = taskStore.create(makeTaskInput({
        auto_review: config as unknown as Record<string, unknown>,
        pipeline_id: 'pl-fanout',
        pipeline_step: 0,
      }))
      const downstreamA = taskStore.create(makeTaskInput({
        summary: 'Downstream A',
        pipeline_id: 'pl-fanout',
        pipeline_step: 1,
        depends_on: [parent.id],
      }))
      const downstreamB = taskStore.create(makeTaskInput({
        summary: 'Downstream B',
        pipeline_id: 'pl-fanout',
        pipeline_step: 1,
        depends_on: [parent.id],
      }))

      taskStore.transition(parent.id, TaskStatus.IN_PROGRESS, {
        lease_owner: 'w',
        lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      })
      taskStore.transition(parent.id, TaskStatus.REVIEW, { result: 'output' })
      handler.onTaskReview(taskStore.getById(parent.id)!)

      const children = taskStore.list({ type: 'review' })
        .filter(t => t.parent_task_id === parent.id)

      completeReviewChild(
        children[0].id,
        '{"approved": false, "feedback": {"what": "x", "where": "y", "fix": "z"}}',
      )
      handler.onReviewChildComplete(taskStore.getById(children[0].id)!)

      const fixTask = taskStore.list({}).find(t => t.metadata?.fix_for === parent.id)!

      expect(taskStore.getById(downstreamA.id)!.depends_on).toContain(fixTask.id)
      expect(taskStore.getById(downstreamB.id)!.depends_on).toContain(fixTask.id)
    })

    it('includes original prompt, result, and review findings in fix prompt', () => {
      const config = makeAutoReviewConfig({
        reviewers: [{ backend: 'openrouter', model: 'model-a' }],
      })

      const parent = createAndTransitionToReview({
        auto_review: config as unknown as Record<string, unknown>,
        prompt: 'Build the auth module',
      })
      handler.onTaskReview(parent)

      const children = taskStore.list({ type: 'review' })
        .filter(t => t.parent_task_id === parent.id)

      completeReviewChild(
        children[0].id,
        '{"approved": false, "reasoning": "Missing OAuth", "feedback": {"what": "no OAuth", "where": "auth.ts", "fix": "add OAuth"}}',
      )
      handler.onReviewChildComplete(taskStore.getById(children[0].id)!)

      const fixTasks = taskStore.list({}).filter(t => t.metadata?.fix_for === parent.id)
      expect(fixTasks[0].prompt).toContain('Build the auth module')
      expect(fixTasks[0].prompt).toContain('Task output here')
      expect(fixTasks[0].prompt).toContain('no OAuth')
    })

    it('passes auto_review config to fix task', () => {
      const config = makeAutoReviewConfig({
        reviewers: [{ backend: 'openrouter', model: 'model-a' }],
      })

      const parent = createAndTransitionToReview({
        auto_review: config as unknown as Record<string, unknown>,
      })
      handler.onTaskReview(parent)

      const children = taskStore.list({ type: 'review' })
        .filter(t => t.parent_task_id === parent.id)

      completeReviewChild(
        children[0].id,
        '{"approved": false, "feedback": {"what": "x", "where": "y", "fix": "z"}}',
      )
      handler.onReviewChildComplete(taskStore.getById(children[0].id)!)

      const fixTasks = taskStore.list({}).filter(t => t.metadata?.fix_for === parent.id)
      expect(fixTasks[0].auto_review).toMatchObject({
        reviewers: [{ backend: 'openrouter', model: 'model-a' }],
        strategy: 'all_must_approve',
      })
    })

    it('increments loop_iteration on fix task', () => {
      const config = makeAutoReviewConfig({
        reviewers: [{ backend: 'openrouter', model: 'model-a' }],
      })

      const parent = createAndTransitionToReview({
        auto_review: config as unknown as Record<string, unknown>,
      })
      expect(parent.loop_iteration).toBe(0)

      handler.onTaskReview(parent)

      const children = taskStore.list({ type: 'review' })
        .filter(t => t.parent_task_id === parent.id)

      completeReviewChild(
        children[0].id,
        '{"approved": false, "feedback": {"what": "x", "where": "y", "fix": "z"}}',
      )
      handler.onReviewChildComplete(taskStore.getById(children[0].id)!)

      const fixTasks = taskStore.list({}).filter(t => t.metadata?.fix_for === parent.id)
      expect(fixTasks[0].loop_iteration).toBe(1)

      const updatedParent = taskStore.getById(parent.id)!
      expect(updatedParent.loop_iteration).toBe(1)
    })

    it('logs fix_injected audit entry', () => {
      const config = makeAutoReviewConfig({
        reviewers: [{ backend: 'openrouter', model: 'model-a' }],
      })

      const parent = createAndTransitionToReview({
        auto_review: config as unknown as Record<string, unknown>,
      })
      handler.onTaskReview(parent)

      const children = taskStore.list({ type: 'review' })
        .filter(t => t.parent_task_id === parent.id)

      completeReviewChild(
        children[0].id,
        '{"approved": false, "feedback": {"what": "x", "where": "y", "fix": "z"}}',
      )
      handler.onReviewChildComplete(taskStore.getById(children[0].id)!)

      const logs = auditLog.getTaskHistory(parent.id)
      const fixLog = logs.find(l => l.action === 'fix_injected')
      expect(fixLog).toBeDefined()
      expect(fixLog!.metadata).toHaveProperty('fix_task_id')
      expect(fixLog!.metadata).toHaveProperty('priority', -10)
    })
  })

  describe('onFixComplete', () => {
    it('updates parent result and transitions to DONE', () => {
      const config = makeAutoReviewConfig({
        reviewers: [{ backend: 'openrouter', model: 'model-a' }],
      })

      const parent = createAndTransitionToReview({
        auto_review: config as unknown as Record<string, unknown>,
      })
      handler.onTaskReview(parent)

      const children = taskStore.list({ type: 'review' })
        .filter(t => t.parent_task_id === parent.id)

      completeReviewChild(
        children[0].id,
        '{"approved": false, "feedback": {"what": "x", "where": "y", "fix": "z"}}',
      )
      handler.onReviewChildComplete(taskStore.getById(children[0].id)!)

      // Get the fix task
      const fixTasks = taskStore.list({}).filter(t => t.metadata?.fix_for === parent.id)
      const fixTask = fixTasks[0]

      // Complete the fix task
      taskStore.transition(fixTask.id, TaskStatus.IN_PROGRESS, {
        lease_owner: 'w',
        lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      })
      taskStore.update(fixTask.id, { result: 'Fixed implementation' })
      // Simulate the fix task reaching DONE (no auto_review for simplicity)
      const fixTaskNoReview = taskStore.update(fixTask.id, { auto_review: null })
      taskStore.transition(fixTask.id, TaskStatus.REVIEW, { result: 'Fixed implementation' })
      taskStore.transition(fixTask.id, TaskStatus.DONE)

      const completedFix = taskStore.getById(fixTask.id)!
      handler.onFixComplete(completedFix)

      const updatedParent = taskStore.getById(parent.id)!
      expect(updatedParent.status).toBe(TaskStatus.DONE)
      expect(updatedParent.result).toBe('Fixed implementation')
    })

    it('logs fix_resolved audit entry', () => {
      const config = makeAutoReviewConfig({
        reviewers: [{ backend: 'openrouter', model: 'model-a' }],
      })

      const parent = createAndTransitionToReview({
        auto_review: config as unknown as Record<string, unknown>,
      })
      handler.onTaskReview(parent)

      const children = taskStore.list({ type: 'review' })
        .filter(t => t.parent_task_id === parent.id)

      completeReviewChild(
        children[0].id,
        '{"approved": false, "feedback": {"what": "x", "where": "y", "fix": "z"}}',
      )
      handler.onReviewChildComplete(taskStore.getById(children[0].id)!)

      const fixTasks = taskStore.list({}).filter(t => t.metadata?.fix_for === parent.id)
      const fixTask = fixTasks[0]

      // Complete fix task without review
      taskStore.transition(fixTask.id, TaskStatus.IN_PROGRESS, {
        lease_owner: 'w',
        lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      })
      taskStore.update(fixTask.id, { auto_review: null })
      taskStore.transition(fixTask.id, TaskStatus.REVIEW, { result: 'fixed' })
      taskStore.transition(fixTask.id, TaskStatus.DONE)

      handler.onFixComplete(taskStore.getById(fixTask.id)!)

      const logs = auditLog.getTaskHistory(parent.id)
      const fixResolvedLog = logs.find(l => l.action === 'fix_resolved')
      expect(fixResolvedLog).toBeDefined()
      expect(fixResolvedLog!.metadata).toHaveProperty('fix_task_id', fixTask.id)
    })

    it('ignores tasks without fix_for metadata', () => {
      const task = taskStore.create(makeTaskInput({ parent_task_id: 'some-id' }))
      handler.onFixComplete(task)
      // No error, no state change
    })

    it('ignores if parent is no longer in REVIEW', () => {
      const parent = createAndTransitionToReview()
      taskStore.transition(parent.id, TaskStatus.DONE)

      const fixTask = taskStore.create(makeTaskInput({
        parent_task_id: parent.id,
        metadata: { fix_for: parent.id },
      }))
      handler.onFixComplete(fixTask)

      expect(taskStore.getById(parent.id)!.status).toBe(TaskStatus.DONE)
    })

    it('ignores stale fix task when parent points to a newer active fix', () => {
      const parent = createAndTransitionToReview({
        metadata: { fix_task_id: 'newer-fix-id' },
      })

      const staleFix = taskStore.create(makeTaskInput({
        summary: 'stale fix',
        parent_task_id: parent.id,
        metadata: { fix_for: parent.id },
      }))

      taskStore.transition(staleFix.id, TaskStatus.IN_PROGRESS, {
        lease_owner: 'w',
        lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      })
      taskStore.transition(staleFix.id, TaskStatus.REVIEW, { result: 'stale fix output' })
      taskStore.transition(staleFix.id, TaskStatus.DONE)

      handler.onFixComplete(taskStore.getById(staleFix.id)!)

      const updatedParent = taskStore.getById(parent.id)!
      expect(updatedParent.status).toBe(TaskStatus.REVIEW)
      expect(updatedParent.result).toBe('Task output here')
    })
  })

  describe('loop_iteration tracking', () => {
    it('ignores stale review children from prior loop iterations', () => {
      const config = makeAutoReviewConfig({
        reviewers: [{ backend: 'openrouter', model: 'model-a' }],
        strategy: 'all_must_approve',
      })

      const parent = createAndTransitionToReview({
        auto_review: config as unknown as Record<string, unknown>,
        loop_iteration: 1,
      })

      // Stale child from iteration 0
      const staleChild = taskStore.create({
        type: 'review',
        summary: 'stale review',
        prompt: 'stale',
        backend: 'openrouter/model-a',
        parent_task_id: parent.id,
        metadata: {
          reviewer_backend: 'openrouter',
          reviewer_model: 'model-a',
          review_iteration: 0,
        },
      })
      completeReviewChild(
        staleChild.id,
        '{"approved": false, "feedback": {"what": "stale", "where": "old", "fix": "ignore"}}',
      )

      handler.onTaskReview(parent)

      const currentChildren = taskStore.list({ type: 'review' })
        .filter(t => t.parent_task_id === parent.id && t.metadata?.review_iteration === 1)
      expect(currentChildren).toHaveLength(1)

      completeReviewChild(currentChildren[0].id, '{"approved": true, "reasoning": "current iteration passes"}')
      handler.onReviewChildComplete(taskStore.getById(currentChildren[0].id)!)

      const updatedParent = taskStore.getById(parent.id)!
      expect(updatedParent.status).toBe(TaskStatus.DONE)
    })
  })

  describe('pipeline hold mechanics', () => {
    it('holds downstream pipeline tasks when fix is created', () => {
      const config = makeAutoReviewConfig({
        reviewers: [{ backend: 'openrouter', model: 'model-a' }],
      })

      const parent = taskStore.create(makeTaskInput({
        auto_review: config as unknown as Record<string, unknown>,
        pipeline_id: 'pl-hold',
        pipeline_step: 0,
      }))
      const downstream1 = taskStore.create(makeTaskInput({
        summary: 'Step 2',
        pipeline_id: 'pl-hold',
        pipeline_step: 1,
        depends_on: [parent.id],
      }))
      const downstream2 = taskStore.create(makeTaskInput({
        summary: 'Step 3',
        pipeline_id: 'pl-hold',
        pipeline_step: 2,
        depends_on: [parent.id],
      }))

      // Move parent to REVIEW
      taskStore.transition(parent.id, TaskStatus.IN_PROGRESS, {
        lease_owner: 'w',
        lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      })
      taskStore.transition(parent.id, TaskStatus.REVIEW, { result: 'output' })
      handler.onTaskReview(taskStore.getById(parent.id)!)

      const children = taskStore.list({ type: 'review' })
        .filter(t => t.parent_task_id === parent.id)

      completeReviewChild(
        children[0].id,
        '{"approved": false, "feedback": {"what": "x", "where": "y", "fix": "z"}}',
      )
      handler.onReviewChildComplete(taskStore.getById(children[0].id)!)

      const fixTask = taskStore.list({}).find(t => t.metadata?.fix_for === parent.id)!

      // Both downstream tasks should be held by the fix task
      expect(taskStore.getById(downstream1.id)!.held_by).toBe(fixTask.id)
      expect(taskStore.getById(downstream2.id)!.held_by).toBe(fixTask.id)
    })

    it('unholds downstream tasks when fix completes', () => {
      const config = makeAutoReviewConfig({
        reviewers: [{ backend: 'openrouter', model: 'model-a' }],
      })

      const parent = taskStore.create(makeTaskInput({
        auto_review: config as unknown as Record<string, unknown>,
        pipeline_id: 'pl-unhold',
        pipeline_step: 0,
      }))
      const downstream = taskStore.create(makeTaskInput({
        summary: 'Step 2',
        pipeline_id: 'pl-unhold',
        pipeline_step: 1,
        depends_on: [parent.id],
      }))

      taskStore.transition(parent.id, TaskStatus.IN_PROGRESS, {
        lease_owner: 'w',
        lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      })
      taskStore.transition(parent.id, TaskStatus.REVIEW, { result: 'output' })
      handler.onTaskReview(taskStore.getById(parent.id)!)

      const children = taskStore.list({ type: 'review' })
        .filter(t => t.parent_task_id === parent.id)

      completeReviewChild(
        children[0].id,
        '{"approved": false, "feedback": {"what": "x", "where": "y", "fix": "z"}}',
      )
      handler.onReviewChildComplete(taskStore.getById(children[0].id)!)

      const fixTask = taskStore.list({}).find(t => t.metadata?.fix_for === parent.id)!

      // Downstream should be held
      expect(taskStore.getById(downstream.id)!.held_by).toBe(fixTask.id)

      // Complete the fix task
      taskStore.transition(fixTask.id, TaskStatus.IN_PROGRESS, {
        lease_owner: 'w',
        lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      })
      taskStore.update(fixTask.id, { auto_review: null })
      taskStore.transition(fixTask.id, TaskStatus.REVIEW, { result: 'Fixed!' })
      taskStore.transition(fixTask.id, TaskStatus.DONE)

      handler.onFixComplete(taskStore.getById(fixTask.id)!)

      // Downstream should be unblocked
      expect(taskStore.getById(downstream.id)!.held_by).toBeNull()
    })

    it('does not hold tasks outside the pipeline', () => {
      const config = makeAutoReviewConfig({
        reviewers: [{ backend: 'openrouter', model: 'model-a' }],
      })

      const parent = taskStore.create(makeTaskInput({
        auto_review: config as unknown as Record<string, unknown>,
        pipeline_id: 'pl-1',
        pipeline_step: 0,
      }))
      const otherTask = taskStore.create(makeTaskInput({
        summary: 'Other pipeline task',
        pipeline_id: 'pl-other',
        pipeline_step: 1,
      }))

      taskStore.transition(parent.id, TaskStatus.IN_PROGRESS, {
        lease_owner: 'w',
        lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      })
      taskStore.transition(parent.id, TaskStatus.REVIEW, { result: 'output' })
      handler.onTaskReview(taskStore.getById(parent.id)!)

      const children = taskStore.list({ type: 'review' })
        .filter(t => t.parent_task_id === parent.id)

      completeReviewChild(
        children[0].id,
        '{"approved": false, "feedback": {"what": "x", "where": "y", "fix": "z"}}',
      )
      handler.onReviewChildComplete(taskStore.getById(children[0].id)!)

      // Other pipeline task should NOT be held
      expect(taskStore.getById(otherTask.id)!.held_by).toBeNull()
    })

    it('holds pending higher-step tasks even when not directly dependent', () => {
      const config = makeAutoReviewConfig({
        reviewers: [{ backend: 'openrouter', model: 'model-a' }],
      })

      const parent = taskStore.create(makeTaskInput({
        auto_review: config as unknown as Record<string, unknown>,
        pipeline_id: 'pl-broad-hold',
        pipeline_step: 1,
      }))

      const direct = taskStore.create(makeTaskInput({
        summary: 'Direct downstream',
        pipeline_id: 'pl-broad-hold',
        pipeline_step: 2,
        depends_on: [parent.id],
      }))

      const indirect = taskStore.create(makeTaskInput({
        summary: 'Indirect downstream',
        pipeline_id: 'pl-broad-hold',
        pipeline_step: 3,
      }))

      const inProgress = taskStore.create(makeTaskInput({
        summary: 'Already running',
        pipeline_id: 'pl-broad-hold',
        pipeline_step: 4,
      }))
      taskStore.transition(inProgress.id, TaskStatus.IN_PROGRESS, {
        lease_owner: 'w',
        lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      })

      taskStore.transition(parent.id, TaskStatus.IN_PROGRESS, {
        lease_owner: 'w',
        lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      })
      taskStore.transition(parent.id, TaskStatus.REVIEW, { result: 'output' })
      handler.onTaskReview(taskStore.getById(parent.id)!)

      const children = taskStore.list({ type: 'review' })
        .filter(t => t.parent_task_id === parent.id)
      completeReviewChild(
        children[0].id,
        '{"approved": false, "feedback": {"what": "x", "where": "y", "fix": "z"}}',
      )
      handler.onReviewChildComplete(taskStore.getById(children[0].id)!)

      expect(taskStore.getById(direct.id)!.held_by).toBeTruthy()
      expect(taskStore.getById(indirect.id)!.held_by).toBeTruthy()
      expect(taskStore.getById(inProgress.id)!.held_by).toBeNull()
    })

    it('emits pipeline_held webhook event when downstream tasks are held', () => {
      const webhookDispatcher = new WebhookDispatcher([])
      const emitSpy = vi.spyOn(webhookDispatcher, 'emit')
      const handlerWithWebhook = new ReviewHandler(taskStore, auditLog, webhookDispatcher)

      const config = makeAutoReviewConfig({
        reviewers: [{ backend: 'openrouter', model: 'model-a' }],
      })

      const parent = taskStore.create(makeTaskInput({
        auto_review: config as unknown as Record<string, unknown>,
        pipeline_id: 'pl-webhook',
        pipeline_step: 0,
      }))
      taskStore.create(makeTaskInput({
        summary: 'Downstream',
        pipeline_id: 'pl-webhook',
        pipeline_step: 1,
        depends_on: [parent.id],
      }))

      taskStore.transition(parent.id, TaskStatus.IN_PROGRESS, {
        lease_owner: 'w',
        lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      })
      taskStore.transition(parent.id, TaskStatus.REVIEW, { result: 'output' })
      handlerWithWebhook.onTaskReview(taskStore.getById(parent.id)!)

      const children = taskStore.list({ type: 'review' })
        .filter(t => t.parent_task_id === parent.id)

      completeReviewChild(
        children[0].id,
        '{"approved": false, "feedback": {"what": "x", "where": "y", "fix": "z"}}',
      )
      handlerWithWebhook.onReviewChildComplete(taskStore.getById(children[0].id)!)

      const heldEvent = emitSpy.mock.calls.find(c => c[0].event === 'pipeline_held')
      expect(heldEvent).toBeDefined()
      expect(heldEvent![0].pipeline_id).toBe('pl-webhook')
      expect(heldEvent![0].metadata?.held_count).toBe(1)
    })

    it('emits pipeline_resumed webhook event when fix completes', () => {
      const webhookDispatcher = new WebhookDispatcher([])
      const emitSpy = vi.spyOn(webhookDispatcher, 'emit')
      const handlerWithWebhook = new ReviewHandler(taskStore, auditLog, webhookDispatcher)

      const config = makeAutoReviewConfig({
        reviewers: [{ backend: 'openrouter', model: 'model-a' }],
      })

      const parent = taskStore.create(makeTaskInput({
        auto_review: config as unknown as Record<string, unknown>,
        pipeline_id: 'pl-resume',
        pipeline_step: 0,
      }))
      taskStore.create(makeTaskInput({
        summary: 'Downstream',
        pipeline_id: 'pl-resume',
        pipeline_step: 1,
        depends_on: [parent.id],
      }))

      taskStore.transition(parent.id, TaskStatus.IN_PROGRESS, {
        lease_owner: 'w',
        lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      })
      taskStore.transition(parent.id, TaskStatus.REVIEW, { result: 'output' })
      handlerWithWebhook.onTaskReview(taskStore.getById(parent.id)!)

      const children = taskStore.list({ type: 'review' })
        .filter(t => t.parent_task_id === parent.id)

      completeReviewChild(
        children[0].id,
        '{"approved": false, "feedback": {"what": "x", "where": "y", "fix": "z"}}',
      )
      handlerWithWebhook.onReviewChildComplete(taskStore.getById(children[0].id)!)

      const fixTask = taskStore.list({}).find(t => t.metadata?.fix_for === parent.id)!

      taskStore.transition(fixTask.id, TaskStatus.IN_PROGRESS, {
        lease_owner: 'w',
        lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      })
      taskStore.update(fixTask.id, { auto_review: null })
      taskStore.transition(fixTask.id, TaskStatus.REVIEW, { result: 'Fixed!' })
      taskStore.transition(fixTask.id, TaskStatus.DONE)

      handlerWithWebhook.onFixComplete(taskStore.getById(fixTask.id)!)

      const resumeEvent = emitSpy.mock.calls.find(c => c[0].event === 'pipeline_resumed')
      expect(resumeEvent).toBeDefined()
      expect(resumeEvent![0].pipeline_id).toBe('pl-resume')
      expect(resumeEvent![0].metadata?.unhold_count).toBe(1)
    })

    it('does not emit pipeline_held when no downstream tasks', () => {
      const webhookDispatcher = new WebhookDispatcher([])
      const emitSpy = vi.spyOn(webhookDispatcher, 'emit')
      const handlerWithWebhook = new ReviewHandler(taskStore, auditLog, webhookDispatcher)

      const config = makeAutoReviewConfig({
        reviewers: [{ backend: 'openrouter', model: 'model-a' }],
      })

      // Single task, no pipeline
      const parent = createAndTransitionToReview({
        auto_review: config as unknown as Record<string, unknown>,
      })
      handlerWithWebhook.onTaskReview(parent)

      const children = taskStore.list({ type: 'review' })
        .filter(t => t.parent_task_id === parent.id)

      completeReviewChild(
        children[0].id,
        '{"approved": false, "feedback": {"what": "x", "where": "y", "fix": "z"}}',
      )
      handlerWithWebhook.onReviewChildComplete(taskStore.getById(children[0].id)!)

      const heldEvent = emitSpy.mock.calls.find(c => c[0].event === 'pipeline_held')
      expect(heldEvent).toBeUndefined()
    })
  })

  describe('edge cases', () => {
    it('ignores non-review child tasks', () => {
      const task = taskStore.create(makeTaskInput({ type: 'coding' }))
      handler.onReviewChildComplete(task)
    })

    it('ignores child tasks with no parent', () => {
      const task = taskStore.create(makeTaskInput({ type: 'review' }))
      handler.onReviewChildComplete(task)
    })

    it('does not act if parent is no longer in REVIEW', () => {
      const config = makeAutoReviewConfig({
        reviewers: [{ backend: 'openrouter', model: 'model-a' }],
      })

      const parent = createAndTransitionToReview({
        auto_review: config as unknown as Record<string, unknown>,
      })
      handler.onTaskReview(parent)

      taskStore.transition(parent.id, TaskStatus.DONE)

      const children = taskStore.list({ type: 'review' })
        .filter(t => t.parent_task_id === parent.id)

      completeReviewChild(children[0].id, '{"approved": true}')
      handler.onReviewChildComplete(taskStore.getById(children[0].id)!)

      expect(taskStore.getById(parent.id)!.status).toBe(TaskStatus.DONE)
    })
  })
})
