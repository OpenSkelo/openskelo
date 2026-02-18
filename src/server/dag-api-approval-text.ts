import type { DAGRun } from "../core/block.js";

export function buildApprovalNotificationText(run: DAGRun, approval: Record<string, unknown>): string {
  const blockId = String(approval.block_id ?? "");
  const prompt = String(approval.prompt ?? "Approval required");

  const preview = approval.context_preview as Record<string, unknown> | undefined;
  const previewText = preview
    ? Object.entries(preview)
        .slice(0, 4)
        .map(([k, v]) => `• ${k}: ${String(typeof v === "string" ? v : JSON.stringify(v)).slice(0, 180)}`)
        .join("\n")
    : "• (no input preview)";

  return [
    "🛑 OpenSkelo needs your approval",
    `Workflow: ${run.dag_name}`,
    `Step: ${blockId}`,
    `Why: ${prompt}`,
    "",
    "Context snapshot:",
    previewText,
    "",
    "Reply with: APPROVE",
    "or: REJECT <reason>",
    `(You can also specify run id: APPROVE ${run.id})`,
  ].join("\n");
}
