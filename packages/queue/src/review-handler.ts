import type { TaskStore, Task, CreateTaskInput, InjectTaskInput } from './task-store.js'
import type { AuditLog } from './audit.js'
import { TaskStatus } from './state-machine.js'

export interface ReviewerConfig {
  backend: string
  prompt_template?: string
  model?: string
}

export interface AutoReviewConfig {
  reviewers: ReviewerConfig[]
  strategy: 'all_must_approve' | 'any_approve' | 'merge_then_decide'
  merge_backend?: string
}

export interface ReviewDecision {
  approved: boolean
  feedback?: { what: string; where: string; fix: string }
  reasoning?: string
}

export function buildReviewPrompt(task: Task, reviewer: ReviewerConfig): string {
  if (reviewer.prompt_template) {
    return reviewer.prompt_template
      .replace('{{summary}}', task.summary)
      .replace('{{prompt}}', task.prompt)
      .replace('{{result}}', task.result ?? '')
      .replace('{{acceptance_criteria}}', JSON.stringify(task.acceptance_criteria))
      .replace('{{definition_of_done}}', JSON.stringify(task.definition_of_done))
  }

  const parts = [
    'You are reviewing AI-generated work. Evaluate the following task result.',
    '',
    `## Task Summary`,
    task.summary,
    '',
    `## Original Prompt`,
    task.prompt,
    '',
    `## Result`,
    task.result ?? '(no result)',
  ]

  if (task.acceptance_criteria.length > 0) {
    parts.push('', '## Acceptance Criteria')
    for (const ac of task.acceptance_criteria) {
      parts.push(`- ${ac}`)
    }
  }

  if (task.definition_of_done.length > 0) {
    parts.push('', '## Definition of Done')
    for (const dod of task.definition_of_done) {
      parts.push(`- ${dod}`)
    }
  }

  parts.push(
    '',
    '## Instructions',
    'Respond with a JSON object:',
    '```json',
    '{',
    '  "approved": true | false,',
    '  "reasoning": "your reasoning here",',
    '  "feedback": {',
    '    "what": "what is wrong",',
    '    "where": "where the issue is",',
    '    "fix": "how to fix it"',
    '  }',
    '}',
    '```',
    'If approved, omit the feedback field.',
  )

  return parts.join('\n')
}

export function buildMergePrompt(
  task: Task,
  reviewResults: Array<{ reviewer: string; decision: ReviewDecision }>,
): string {
  const parts = [
    'You are a merge reviewer. Multiple reviewers have evaluated the same task.',
    'Synthesize their feedback and make a final decision.',
    '',
    `## Task Summary`,
    task.summary,
    '',
    `## Result`,
    task.result ?? '(no result)',
    '',
    '## Reviewer Decisions',
  ]

  for (const r of reviewResults) {
    parts.push(
      `### ${r.reviewer}`,
      `- Approved: ${r.decision.approved}`,
      `- Reasoning: ${r.decision.reasoning ?? 'none'}`,
    )
    if (r.decision.feedback) {
      parts.push(
        `- Feedback: ${r.decision.feedback.what} (${r.decision.feedback.where}) — fix: ${r.decision.feedback.fix}`,
      )
    }
    parts.push('')
  }

  parts.push(
    '## Instructions',
    'Respond with a JSON object:',
    '```json',
    '{',
    '  "approved": true | false,',
    '  "reasoning": "your synthesized reasoning",',
    '  "feedback": {',
    '    "what": "consolidated issue",',
    '    "where": "where the issue is",',
    '    "fix": "how to fix it"',
    '  }',
    '}',
    '```',
    'If approved, omit the feedback field.',
  )

  return parts.join('\n')
}

export function parseReviewDecision(output: string): ReviewDecision {
  // Try to extract JSON from the output
  const jsonMatch = output.match(/```(?:json)?\s*([\s\S]*?)```/)
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : output.trim()

  try {
    const parsed = JSON.parse(jsonStr)
    if (typeof parsed.approved === 'boolean') {
      const decision: ReviewDecision = { approved: parsed.approved }
      if (parsed.reasoning) decision.reasoning = String(parsed.reasoning)
      if (parsed.feedback && typeof parsed.feedback === 'object') {
        decision.feedback = {
          what: String(parsed.feedback.what ?? ''),
          where: String(parsed.feedback.where ?? ''),
          fix: String(parsed.feedback.fix ?? ''),
        }
      }
      return decision
    }
  } catch {
    // Fall through to heuristics
  }

  // Heuristic fallback
  const lower = output.toLowerCase()
  const rejectionHints = ['not approved', 'not approve', 'reject', 'rejected', 'needs changes']
  if (rejectionHints.some(hint => lower.includes(hint))) {
    return {
      approved: false,
      reasoning: 'Heuristic: detected rejection language',
      feedback: {
        what: 'Reviewer indicated rejection in free-form output',
        where: 'review',
        fix: 'Address noted issues and re-run review',
      },
    }
  }

  if (lower.includes('approved') || lower.includes('looks good') || lower.includes('lgtm')) {
    return { approved: true, reasoning: 'Heuristic: detected approval language' }
  }

  return {
    approved: false,
    reasoning: 'Heuristic: could not parse decision, defaulting to reject',
    feedback: {
      what: 'Review output could not be parsed',
      where: 'review',
      fix: 'Re-run the review with clearer output format',
    },
  }
}

export function buildFixPrompt(
  parent: Task,
  reasoning: string,
  issues: unknown[],
): string {
  const parts = [
    '## Original Task',
    `Summary: ${parent.summary}`,
    '',
    '## Original Prompt',
    parent.prompt,
    '',
    '## Previous Implementation',
    parent.result ?? '(no result)',
    '',
    '## Review Findings',
  ]

  if (reasoning) {
    parts.push(reasoning)
  }

  if (Array.isArray(issues) && issues.length > 0) {
    parts.push('')
    parts.push('## Specific Issues')
    for (const issue of issues) {
      const i = issue as Record<string, unknown>
      const severity = i.severity ?? 'unknown'
      const description = i.description ?? i.what ?? ''
      const location = i.location ?? i.where
      const fix = i.fix
      parts.push(`- [${severity}] ${description}${location ? ` (${location})` : ''}${fix ? ` → Fix: ${fix}` : ''}`)
    }
  }

  parts.push('')
  parts.push('## Instructions')
  parts.push('Fix ALL issues listed above. Maintain all existing functionality. Include tests for the fixes.')

  return parts.join('\n')
}

export class ReviewHandler {
  private taskStore: TaskStore
  private auditLog: AuditLog

  constructor(taskStore: TaskStore, auditLog: AuditLog) {
    this.taskStore = taskStore
    this.auditLog = auditLog
  }

  onTaskReview(task: Task): void {
    // Auto-approve review children (review of review not needed)
    if (task.type === 'review' && task.parent_task_id) {
      this.auditLog.logAction({
        task_id: task.id,
        action: 'auto_approve_review_child',
        metadata: { parent_task_id: task.parent_task_id },
      })
      this.taskStore.transition(task.id, TaskStatus.DONE)
      return
    }

    const config = task.auto_review as AutoReviewConfig | null
    if (!config || !config.reviewers || config.reviewers.length === 0) {
      return
    }

    this.auditLog.logAction({
      task_id: task.id,
      action: 'auto_review_started',
      metadata: {
        strategy: config.strategy,
        reviewer_count: config.reviewers.length,
        loop_iteration: task.loop_iteration,
      },
    })

    for (let i = 0; i < config.reviewers.length; i++) {
      const reviewer = config.reviewers[i]
      const reviewPrompt = buildReviewPrompt(task, reviewer)

      const backendWithModel = reviewer.model
        ? `${reviewer.backend}/${reviewer.model}`
        : reviewer.backend

      const childInput: CreateTaskInput = {
        type: 'review',
        summary: `Review of "${task.summary}" by ${reviewer.backend}${reviewer.model ? '/' + reviewer.model : ''} [${i + 1}/${config.reviewers.length}]`,
        prompt: reviewPrompt,
        backend: backendWithModel,
        parent_task_id: task.id,
        metadata: {
          reviewer_index: i,
          reviewer_backend: reviewer.backend,
          reviewer_model: reviewer.model ?? null,
          review_iteration: task.loop_iteration,
        },
      }

      this.taskStore.create(childInput)
    }
  }

  onReviewChildComplete(childTask: Task): void {
    if (childTask.type !== 'review' || !childTask.parent_task_id) {
      return
    }

    const parentTask = this.taskStore.getById(childTask.parent_task_id)
    if (!parentTask) return

    const currentIteration = parentTask.loop_iteration

    // Check if this is a merge task
    if (childTask.metadata?.is_merge) {
      const mergeIteration = Number(childTask.metadata?.review_iteration ?? 0)
      if (mergeIteration !== currentIteration) return
      this.onMergeComplete(childTask)
      return
    }

    const childIteration = Number(childTask.metadata?.review_iteration ?? 0)
    if (childIteration !== currentIteration) return

    // Parent must still be in REVIEW
    if (parentTask.status !== TaskStatus.REVIEW) return

    const config = parentTask.auto_review as AutoReviewConfig | null
    if (!config) return

    // Get review children only for the current iteration
    const allChildren = this.taskStore.list({ type: 'review' })
      .filter(t =>
        t.parent_task_id === parentTask.id
        && !t.metadata?.is_merge
        && Number(t.metadata?.review_iteration ?? 0) === currentIteration,
      )

    if (allChildren.length === 0) return

    const completedChildren = allChildren.filter(t => t.status === TaskStatus.DONE)

    // Not all children done yet
    if (completedChildren.length < allChildren.length) return

    // Parse decisions from all children
    const decisions = completedChildren.map(child => ({
      reviewer: `${child.metadata?.reviewer_backend ?? 'unknown'}${child.metadata?.reviewer_model ? '/' + child.metadata.reviewer_model : ''}`,
      decision: parseReviewDecision(child.result ?? ''),
    }))

    this.auditLog.logAction({
      task_id: parentTask.id,
      action: 'auto_review_decisions_collected',
      metadata: { decisions },
    })

    this.applyStrategy(parentTask, config, decisions)
  }

  private onMergeComplete(mergeTask: Task): void {
    const parentTask = this.taskStore.getById(mergeTask.parent_task_id!)
    if (!parentTask) return
    if (parentTask.status !== TaskStatus.REVIEW) return

    const decision = parseReviewDecision(mergeTask.result ?? '')

    this.auditLog.logAction({
      task_id: parentTask.id,
      action: 'auto_review_merge_complete',
      metadata: { decision },
    })

    this.applyDecision(parentTask, decision)
  }

  private applyStrategy(
    parentTask: Task,
    config: AutoReviewConfig,
    decisions: Array<{ reviewer: string; decision: ReviewDecision }>,
  ): void {
    switch (config.strategy) {
      case 'all_must_approve': {
        const allApproved = decisions.every(d => d.decision.approved)
        if (allApproved) {
          this.applyDecision(parentTask, { approved: true, reasoning: 'All reviewers approved' })
        } else {
          // Use the first rejection's feedback
          const rejection = decisions.find(d => !d.decision.approved)!
          this.applyDecision(parentTask, {
            approved: false,
            reasoning: `Rejected by ${rejection.reviewer}`,
            feedback: rejection.decision.feedback,
          })
        }
        break
      }

      case 'any_approve': {
        const anyApproved = decisions.some(d => d.decision.approved)
        if (anyApproved) {
          this.applyDecision(parentTask, { approved: true, reasoning: 'At least one reviewer approved' })
        } else {
          const rejection = decisions[0]
          this.applyDecision(parentTask, {
            approved: false,
            reasoning: 'No reviewers approved',
            feedback: rejection.decision.feedback,
          })
        }
        break
      }

      case 'merge_then_decide': {
        const mergeBackend = config.merge_backend ?? config.reviewers[0].backend
        const mergePrompt = buildMergePrompt(parentTask, decisions)

        const mergeInput: CreateTaskInput = {
          type: 'review',
          summary: `Merge review for "${parentTask.summary}"`,
          prompt: mergePrompt,
          backend: mergeBackend,
          parent_task_id: parentTask.id,
          metadata: {
            is_merge: true,
            review_iteration: parentTask.loop_iteration,
          },
        }

        this.taskStore.create(mergeInput)
        break
      }
    }
  }

  onFixComplete(fixTask: Task): void {
    const parentId = fixTask.parent_task_id
    if (!parentId) return
    if (!fixTask.metadata?.fix_for) return

    const parent = this.taskStore.getById(parentId)
    if (!parent) return
    if (parent.status !== TaskStatus.REVIEW) return

    this.taskStore.update(parent.id, {
      result: fixTask.result,
    })

    this.taskStore.transition(parent.id, TaskStatus.DONE)

    this.auditLog.logAction({
      task_id: parent.id,
      action: 'fix_resolved',
      metadata: { fix_task_id: fixTask.id },
    })
  }

  private applyDecision(parentTask: Task, decision: ReviewDecision): void {
    if (decision.approved) {
      this.auditLog.logAction({
        task_id: parentTask.id,
        action: 'auto_review_approved',
        metadata: { reasoning: decision.reasoning },
      })
      this.taskStore.transition(parentTask.id, TaskStatus.DONE)
    } else {
      this.createFixTask(parentTask, decision)
    }
  }

  private createFixTask(parent: Task, decision: ReviewDecision): Task {
    const feedback = decision.feedback ?? {
      what: decision.reasoning ?? 'Review rejected',
      where: 'review',
      fix: 'Address the reviewer feedback and resubmit',
    }

    const issues = decision.feedback ? [decision.feedback] : []
    const fixPrompt = buildFixPrompt(parent, decision.reasoning ?? '', issues)

    // Find downstream task that depends on parent in the same pipeline
    let downstream: Task | undefined
    if (parent.pipeline_id) {
      const allTasks = this.taskStore.list({})
      downstream = allTasks.find(
        t => t.depends_on?.includes(parent.id) && t.pipeline_id === parent.pipeline_id,
      )
    }

    const injectInput: InjectTaskInput = {
      type: parent.type,
      summary: `Fix: ${parent.summary}`,
      prompt: fixPrompt,
      backend: parent.backend,
      parent_task_id: parent.id,
      pipeline_id: parent.pipeline_id ?? undefined,
      pipeline_step: parent.pipeline_step ?? undefined,
      priority_boost: -10,
      inject_before: downstream?.id,
      auto_review: parent.auto_review ?? undefined,
      loop_iteration: parent.loop_iteration + 1,
      metadata: {
        fix_for: parent.id,
        issues_count: issues.length,
      },
    }

    const fixTask = this.taskStore.inject(injectInput)

    this.auditLog.logAction({
      task_id: parent.id,
      action: 'fix_injected',
      metadata: {
        fix_task_id: fixTask.id,
        blocked_downstream: downstream?.id,
        priority: -10,
      },
    })

    this.taskStore.update(parent.id, {
      loop_iteration: parent.loop_iteration + 1,
      metadata: { ...parent.metadata, fix_task_id: fixTask.id },
    })

    return fixTask
  }
}
