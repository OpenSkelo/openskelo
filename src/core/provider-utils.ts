import type { DispatchRequest } from "../types.js";

export function buildPrompt(request: DispatchRequest): string {
  const lines: string[] = [];
  lines.push(`# ${request.title}`);
  lines.push("");
  lines.push(request.description);
  if (request.acceptanceCriteria?.length) {
    lines.push("", "Acceptance Criteria:");
    for (const c of request.acceptanceCriteria) lines.push(`- ${c}`);
  }
  if (request.previousNotes) lines.push("", `Previous Notes:\n${request.previousNotes}`);
  if (request.context && Object.keys(request.context).length) {
    lines.push("", "Context:", JSON.stringify(request.context, null, 2));
  }
  return lines.join("\n");
}
