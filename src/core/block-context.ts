import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";

export interface BlockContext {
  /** Contents of role.md — goes into system prompt */
  role: string;
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
  const task = readFileSafe(join(dir, "task.md"));

  let context = "";
  const contextDir = join(dir, "context");
  if (existsSync(contextDir)) {
    const files = readdirSync(contextDir)
      .filter((f) => f.toLowerCase().endsWith(".md"))
      .sort();

    context = files
      .map((f) => readFileSafe(join(contextDir, f)))
      .filter(Boolean)
      .join("\n\n---\n\n");
  }

  return { role, task, context };
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
