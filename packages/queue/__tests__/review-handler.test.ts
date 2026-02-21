import { describe, it, expect, beforeEach } from 'vitest'
import { createDatabase } from '../src/db.js'
import { TaskStore } from '../src/task-store.js'
import type { Task, CreateTaskInput } from '../src/task-store.js'
import { AuditLog } from '../src/audit.js'
import { TaskStatus } from '../src/state-machine.js'
import {
  ReviewHandler,
  buildReviewPrompt,
  buildMergePrompt,
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

      // Transition child through to REVIEW
      const child = children[0]
      taskStore.transition(child.id, TaskStatus.IN_PROGRESS, {
        lease_owner: 'worker-2',
        lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      })
      const reviewChild = taskStore.transition(child.id, TaskStatus.REVIEW, {
        result: '{"approved": true, "reasoning": "LGTM"}',
      })

      // ReviewHandler should auto-approve this
      handler.onTaskReview(reviewChild)

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

      // Complete both children with approval
      for (const child of children) {
        taskStore.transition(child.id, TaskStatus.IN_PROGRESS, {
          lease_owner: 'w',
          lease_expires_at: new Date(Date.now() + 60000).toISOString(),
        })
        taskStore.transition(child.id, TaskStatus.REVIEW, {
          result: '{"approved": true, "reasoning": "good"}',
        })
        // Auto-approve the review child
        const reviewChild = taskStore.getById(child.id)!
        handler.onTaskReview(reviewChild)
      }

      // Trigger strategy evaluation from last child
      const lastChild = taskStore.getById(children[children.length - 1].id)!
      handler.onReviewChildComplete(lastChild)

      const updatedParent = taskStore.getById(parent.id)!
      expect(updatedParent.status).toBe(TaskStatus.DONE)
    })

    it('bounces parent when any reviewer rejects', () => {
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
      taskStore.transition(children[0].id, TaskStatus.IN_PROGRESS, {
        lease_owner: 'w',
        lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      })
      taskStore.transition(children[0].id, TaskStatus.REVIEW, {
        result: '{"approved": true}',
      })
      handler.onTaskReview(taskStore.getById(children[0].id)!)

      // Second child rejects
      taskStore.transition(children[1].id, TaskStatus.IN_PROGRESS, {
        lease_owner: 'w',
        lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      })
      taskStore.transition(children[1].id, TaskStatus.REVIEW, {
        result: '{"approved": false, "reasoning": "bad", "feedback": {"what": "bug", "where": "here", "fix": "that"}}',
      })
      handler.onTaskReview(taskStore.getById(children[1].id)!)

      handler.onReviewChildComplete(taskStore.getById(children[1].id)!)

      const updatedParent = taskStore.getById(parent.id)!
      expect(updatedParent.status).toBe(TaskStatus.PENDING)
      expect(updatedParent.bounce_count).toBe(1)
      expect(updatedParent.loop_iteration).toBe(1)
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
      for (let i = 0; i < children.length; i++) {
        taskStore.transition(children[i].id, TaskStatus.IN_PROGRESS, {
          lease_owner: 'w',
          lease_expires_at: new Date(Date.now() + 60000).toISOString(),
        })
        const result = i === 0
          ? '{"approved": false, "reasoning": "nope", "feedback": {"what": "x", "where": "y", "fix": "z"}}'
          : '{"approved": true, "reasoning": "good"}'
        taskStore.transition(children[i].id, TaskStatus.REVIEW, { result })
        handler.onTaskReview(taskStore.getById(children[i].id)!)
      }

      handler.onReviewChildComplete(taskStore.getById(children[1].id)!)

      const updatedParent = taskStore.getById(parent.id)!
      expect(updatedParent.status).toBe(TaskStatus.DONE)
    })

    it('bounces parent when no reviewers approve', () => {
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

      taskStore.transition(children[0].id, TaskStatus.IN_PROGRESS, {
        lease_owner: 'w',
        lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      })
      taskStore.transition(children[0].id, TaskStatus.REVIEW, {
        result: '{"approved": false, "feedback": {"what": "x", "where": "y", "fix": "z"}}',
      })
      handler.onTaskReview(taskStore.getById(children[0].id)!)

      handler.onReviewChildComplete(taskStore.getById(children[0].id)!)

      const updatedParent = taskStore.getById(parent.id)!
      expect(updatedParent.status).toBe(TaskStatus.PENDING)
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
        taskStore.transition(child.id, TaskStatus.IN_PROGRESS, {
          lease_owner: 'w',
          lease_expires_at: new Date(Date.now() + 60000).toISOString(),
        })
        taskStore.transition(child.id, TaskStatus.REVIEW, {
          result: '{"approved": true, "reasoning": "fine"}',
        })
        handler.onTaskReview(taskStore.getById(child.id)!)
      }

      handler.onReviewChildComplete(taskStore.getById(children[1].id)!)

      // Should have created a merge task
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

      // Complete review child
      taskStore.transition(children[0].id, TaskStatus.IN_PROGRESS, {
        lease_owner: 'w',
        lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      })
      taskStore.transition(children[0].id, TaskStatus.REVIEW, {
        result: '{"approved": true}',
      })
      handler.onTaskReview(taskStore.getById(children[0].id)!)
      handler.onReviewChildComplete(taskStore.getById(children[0].id)!)

      // Now complete the merge task
      const mergeTasks = taskStore.list({ type: 'review' })
        .filter(t => t.metadata?.is_merge && t.parent_task_id === parent.id)
      expect(mergeTasks).toHaveLength(1)

      const mergeTask = mergeTasks[0]
      taskStore.transition(mergeTask.id, TaskStatus.IN_PROGRESS, {
        lease_owner: 'w',
        lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      })
      taskStore.transition(mergeTask.id, TaskStatus.REVIEW, {
        result: '{"approved": true, "reasoning": "all good"}',
      })
      handler.onTaskReview(taskStore.getById(mergeTask.id)!)
      handler.onReviewChildComplete(taskStore.getById(mergeTask.id)!)

      const updatedParent = taskStore.getById(parent.id)!
      expect(updatedParent.status).toBe(TaskStatus.DONE)
    })
  })

  describe('loop_iteration tracking', () => {
    it('increments loop_iteration on bounce', () => {
      const config = makeAutoReviewConfig({
        reviewers: [{ backend: 'openrouter', model: 'model-a' }],
        strategy: 'all_must_approve',
      })

      const parent = createAndTransitionToReview({
        auto_review: config as unknown as Record<string, unknown>,
      })
      expect(parent.loop_iteration).toBe(0)

      handler.onTaskReview(parent)

      const children = taskStore.list({ type: 'review' })
        .filter(t => t.parent_task_id === parent.id)

      taskStore.transition(children[0].id, TaskStatus.IN_PROGRESS, {
        lease_owner: 'w',
        lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      })
      taskStore.transition(children[0].id, TaskStatus.REVIEW, {
        result: '{"approved": false, "feedback": {"what": "x", "where": "y", "fix": "z"}}',
      })
      handler.onTaskReview(taskStore.getById(children[0].id)!)
      handler.onReviewChildComplete(taskStore.getById(children[0].id)!)

      const updatedParent = taskStore.getById(parent.id)!
      expect(updatedParent.loop_iteration).toBe(1)
      expect(updatedParent.status).toBe(TaskStatus.PENDING)
    })

    it('ignores stale review children from prior loop iterations', () => {
      const config = makeAutoReviewConfig({
        reviewers: [{ backend: 'openrouter', model: 'model-a' }],
        strategy: 'all_must_approve',
      })

      const parent = createAndTransitionToReview({
        auto_review: config as unknown as Record<string, unknown>,
        loop_iteration: 1,
      })

      // Stale child from iteration 0 should not influence iteration 1 decision.
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
      taskStore.transition(staleChild.id, TaskStatus.IN_PROGRESS, {
        lease_owner: 'w',
        lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      })
      taskStore.transition(staleChild.id, TaskStatus.REVIEW, {
        result: '{"approved": false, "feedback": {"what": "stale", "where": "old", "fix": "ignore"}}',
      })
      handler.onTaskReview(taskStore.getById(staleChild.id)!)

      handler.onTaskReview(parent)

      const currentChildren = taskStore.list({ type: 'review' })
        .filter(t => t.parent_task_id === parent.id && t.metadata?.review_iteration === 1)
      expect(currentChildren).toHaveLength(1)

      taskStore.transition(currentChildren[0].id, TaskStatus.IN_PROGRESS, {
        lease_owner: 'w',
        lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      })
      taskStore.transition(currentChildren[0].id, TaskStatus.REVIEW, {
        result: '{"approved": true, "reasoning": "current iteration passes"}',
      })
      handler.onTaskReview(taskStore.getById(currentChildren[0].id)!)
      handler.onReviewChildComplete(taskStore.getById(currentChildren[0].id)!)

      const updatedParent = taskStore.getById(parent.id)!
      expect(updatedParent.status).toBe(TaskStatus.DONE)
    })
  })

  describe('edge cases', () => {
    it('ignores non-review child tasks', () => {
      const task = taskStore.create(makeTaskInput({ type: 'coding' }))
      // Should not throw
      handler.onReviewChildComplete(task)
    })

    it('ignores child tasks with no parent', () => {
      const task = taskStore.create(makeTaskInput({ type: 'review' }))
      handler.onReviewChildComplete(task)
      // No error
    })

    it('does not act if parent is no longer in REVIEW', () => {
      const config = makeAutoReviewConfig({
        reviewers: [{ backend: 'openrouter', model: 'model-a' }],
      })

      const parent = createAndTransitionToReview({
        auto_review: config as unknown as Record<string, unknown>,
      })
      handler.onTaskReview(parent)

      // Manually transition parent to DONE before children finish
      taskStore.transition(parent.id, TaskStatus.DONE)

      const children = taskStore.list({ type: 'review' })
        .filter(t => t.parent_task_id === parent.id)

      taskStore.transition(children[0].id, TaskStatus.IN_PROGRESS, {
        lease_owner: 'w',
        lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      })
      taskStore.transition(children[0].id, TaskStatus.REVIEW, {
        result: '{"approved": true}',
      })
      handler.onTaskReview(taskStore.getById(children[0].id)!)
      handler.onReviewChildComplete(taskStore.getById(children[0].id)!)

      // Parent should still be DONE
      expect(taskStore.getById(parent.id)!.status).toBe(TaskStatus.DONE)
    })
  })
})
