import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import yaml from "yaml";

export interface BlockContext {
  /** Contents of role.md — goes into system prompt */
  role: string;
  /** Contents of rules.md — injected after role as hard constraints */
  rules: string;
  /** Active policy summaries from policies/*.yaml */
  policies: string;
  /** Compact XML summary of available skills */
  skill_summaries: string;
  /** Contents of task.md — prepended to user prompt */
  task: string;
  /** Concatenated contents of context/*.md — appended to system prompt */
  context: string;
}

export function loadBlockContext(blockDir: string, projectRoot: string): BlockContext {
  const projectAbs = resolve(projectRoot);
  const dir = resolve(projectAbs, blockDir);
  if (!isPathInside(projectAbs, dir)) {
    throw new Error(`block_dir "${blockDir}" resolves outside project root`);
  }

  const role = readFileSafe(join(dir, "role.md"));
  const rules = readFileSafe(join(dir, "rules.md"));
  const task = readFileSafe(join(dir, "task.md"));
  const policies = loadPolicies(join(dir, "policies"));
  const skill_summaries = loadSkillSummaries(join(dir, "skills"));
  const context = loadMarkdownDirectory(join(dir, "context"));

  return { role, rules, policies, skill_summaries, task, context };
}

function loadMarkdownDirectory(path: string): string {
  if (!existsSync(path)) return "";
  const files = readdirSync(path)
    .filter((f) => f.toLowerCase().endsWith(".md"))
    .sort();

  return files
    .map((f) => readFileSafe(join(path, f)))
    .filter(Boolean)
    .join("\n\n---\n\n");
}

function loadPolicies(policiesDir: string): string {
  if (!existsSync(policiesDir)) return "";
  const files = readdirSync(policiesDir)
    .filter((f) => f.toLowerCase().endsWith(".yaml") || f.toLowerCase().endsWith(".yml"))
    .sort();

  const lines: string[] = [];
  for (const file of files) {
    try {
      const raw = readFileSafe(join(policiesDir, file));
      if (!raw) continue;
      const data = yaml.parse(raw) as Record<string, unknown> | null;
      if (!data) continue;

      const status = String(data.status ?? "active").toLowerCase();
      if (status !== "active") continue;

      const id = String(data.id ?? file.replace(/\.(ya?ml)$/i, "")).trim();
      const trigger = String(data.trigger ?? "").trim();
      const action = String(data.action ?? "").trim();
      const severity = String(data.severity ?? "P1").trim();
      if (!id || !trigger || !action) continue;
      lines.push(`- ${id}: ${trigger} → ${action} [${severity}]`);
    } catch {
      // ignore malformed policy files
    }
  }

  if (lines.length === 0) return "";
  return `GATING POLICIES (auto-generated from operational failures — treat as hard rules):\n${lines.join("\n")}`;
}

function loadSkillSummaries(skillsDir: string): string {
  if (!existsSync(skillsDir)) return "";
  const files = readdirSync(skillsDir)
    .filter((f) => f.toLowerCase().endsWith(".md"))
    .sort();

  const skills: string[] = [];
  for (const file of files) {
    const raw = readFileSafe(join(skillsDir, file));
    if (!raw) continue;
    const fm = parseFrontmatter(raw);
    if (!fm?.name || !fm?.description) continue;
    skills.push(
      `  <skill name="${escapeXml(fm.name)}" path="skills/${escapeXml(file)}">${escapeXml(fm.description)}</skill>`
    );
  }

  if (skills.length === 0) return "";
  return [
    "<available_skills>",
    ...skills,
    "</available_skills>",
    "Scan the available skills. If one clearly applies to your current task, read its full content before proceeding. Never read more than one skill upfront.",
  ].join("\n");
}

function parseFrontmatter(markdown: string): { name?: string; description?: string } | null {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  try {
    const data = yaml.parse(match[1]) as Record<string, unknown> | null;
    if (!data) return null;
    return {
      name: typeof data.name === "string" ? data.name.trim() : undefined,
      description: typeof data.description === "string" ? data.description.trim() : undefined,
    };
  } catch {
    return null;
  }
}

function escapeXml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function readFileSafe(path: string): string {
  try {
    return readFileSync(path, "utf-8").trim();
  } catch {
    return "";
  }
}

function isPathInside(root: string, target: string): boolean {
  if (target === root) return true;
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;
  return target.startsWith(rootWithSep);
}
