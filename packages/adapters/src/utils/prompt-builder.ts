import type { TaskInput } from '../types.js'

export function buildTaskPrompt(task: TaskInput): string {
  const sections: string[] = []

  sections.push(`Task: ${task.summary}\n\n${task.prompt}`)

  if (task.acceptance_criteria?.length) {
    sections.push(
      'Acceptance Criteria\n' +
      task.acceptance_criteria.map(c => `- ${c}`).join('\n')
    )
  }

  if (task.definition_of_done?.length) {
    sections.push(
      'Definition of Done\n' +
      task.definition_of_done.map(d => `- ${d}`).join('\n')
    )
  }

  if (task.retry_context) {
    const rc = task.retry_context
    sections.push(
      `Previous Attempt Failed\nAttempt ${rc.attempt}. Fix these issues:\n${rc.feedback}`
    )
  }

  if (task.bounce_context?.feedback.length) {
    const bc = task.bounce_context
    const items = bc.feedback
      .map(f => `- WHAT: ${f.what}\n  WHERE: ${f.where}\n  FIX: ${f.fix}`)
      .join('\n')
    sections.push(
      `Human Review Feedback (Bounce #${bc.bounce_count})\n${items}`
    )
  }

  if (task.upstream_results && Object.keys(task.upstream_results).length) {
    sections.push(
      `Context from Previous Steps\n${JSON.stringify(task.upstream_results, null, 2)}`
    )
  }

  return sections.join('\n\n')
}
