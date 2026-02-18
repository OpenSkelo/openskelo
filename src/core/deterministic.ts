import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface DeterministicHandlerContext {
  inputs: Record<string, unknown>;
  config: Record<string, unknown>;
  blockId: string;
  runId: string;
}

export type DeterministicHandler = (
  ctx: DeterministicHandlerContext
) => Promise<Record<string, unknown>> | Record<string, unknown>;

function fmtTimestamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

function resolveSafePath(path: string): string {
  const raw = String(path || "").trim();
  if (!raw) throw new Error("path is empty");

  // Allow portable templates and paths.
  const home = process.env.HOME || "";
  const expanded = raw.replaceAll("{home}", home || "");

  // Absolute path stays absolute; relative path is resolved from CWD.
  return expanded.startsWith("/") ? expanded : resolve(process.cwd(), expanded);
}

const builtins: Record<string, DeterministicHandler> = {
  "builtin:write-file": (ctx) => {
    const cfg = ctx.config ?? {};
    const contentFrom = String(cfg.content_from ?? "").trim();
    if (!contentFrom) throw new Error("write-file requires config.content_from");

    const contentVal = ctx.inputs[contentFrom];
    if (typeof contentVal !== "string") throw new Error(`write-file content_from '${contentFrom}' must resolve to string`);

    let finalContent = contentVal;
    const appendImagesFrom = String(cfg.append_images_from ?? "").trim();
    if (appendImagesFrom && ctx.inputs[appendImagesFrom] && typeof ctx.inputs[appendImagesFrom] === "object") {
      const urls = ctx.inputs[appendImagesFrom] as Record<string, unknown>;
      const entries = Object.entries(urls).filter(([, v]) => typeof v === "string" && String(v).trim());
      if (entries.length) {
        const imageSection = ["", "## Images", "", ...entries.map(([k, v]) => `- [${k}](${String(v)})`), ""].join("\n");
        if (!finalContent.includes("## Images")) finalContent += imageSection;
      }
    }

    const pathFrom = String(cfg.path_from ?? "").trim();
    let targetPath = "";
    if (pathFrom && typeof ctx.inputs[pathFrom] === "string" && String(ctx.inputs[pathFrom]).trim()) {
      targetPath = String(ctx.inputs[pathFrom]).trim();
    } else {
      const template = String(cfg.default_path_template ?? "").trim();
      if (!template) throw new Error("write-file requires path_from input or config.default_path_template");
      targetPath = template.replaceAll("{timestamp}", fmtTimestamp());
    }

    targetPath = resolveSafePath(targetPath);
    const overwrite = cfg.overwrite === true;
    if (!overwrite && existsSync(targetPath)) throw new Error(`write-file target exists and overwrite=false: ${targetPath}`);

    const mkdir = cfg.mkdir !== false;
    if (mkdir) mkdirSync(dirname(targetPath), { recursive: true });

    writeFileSync(targetPath, finalContent, "utf-8");
    const bytes = Buffer.byteLength(finalContent, "utf-8");

    return {
      desktop_file_path: targetPath,
      desktop_file_name: basename(targetPath),
      file_path: targetPath,
      file_name: basename(targetPath),
      bytes_written: bytes,
      save_summary: `Wrote ${bytes} bytes to ${targetPath}`,
      final_markdown: finalContent,
    };
  },
  "builtin:read-file": (ctx) => {
    const cfg = ctx.config ?? {};
    const pathFrom = String(cfg.path_from ?? "").trim();
    let sourcePath = "";
    if (pathFrom && typeof ctx.inputs[pathFrom] === "string") sourcePath = String(ctx.inputs[pathFrom]);
    if (!sourcePath) sourcePath = String(cfg.path ?? "").trim();
    sourcePath = resolveSafePath(sourcePath);
    const content = readFileSync(sourcePath, "utf-8");
    return { file_path: sourcePath, content, bytes: Buffer.byteLength(content, "utf-8") };
  },
  "builtin:http-request": async (ctx) => {
    const cfg = ctx.config ?? {};
    const url = String(cfg.url ?? "").trim();
    if (!url) throw new Error("http-request requires config.url");
    const method = String(cfg.method ?? "GET").toUpperCase();
    const headers = (cfg.headers && typeof cfg.headers === "object") ? cfg.headers as Record<string, string> : {};
    const body = cfg.body ?? undefined;
    const res = await fetch(url, { method, headers, body: typeof body === "string" ? body : body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    return { status: res.status, ok: res.ok, body: text };
  },
  "builtin:transform": (ctx) => {
    const cfg = ctx.config ?? {};
    const map = (cfg.map && typeof cfg.map === "object") ? cfg.map as Record<string, string> : {};
    const out: Record<string, unknown> = {};
    for (const [outKey, inKey] of Object.entries(map)) out[outKey] = ctx.inputs[inKey];
    return out;
  },
};

export async function runDeterministicHandler(
  handlerRef: string,
  ctx: DeterministicHandlerContext
): Promise<Record<string, unknown>> {
  if (builtins[handlerRef]) return await builtins[handlerRef](ctx);

  const full = resolve(process.cwd(), handlerRef);
  const mod = await import(pathToFileURL(full).href);
  const fn = (mod.default ?? mod.handler) as DeterministicHandler | undefined;
  if (typeof fn !== "function") throw new Error(`Deterministic handler must export default or named 'handler' function: ${handlerRef}`);
  const out = await fn(ctx);
  if (!out || typeof out !== "object") throw new Error(`Deterministic handler returned invalid outputs: ${handlerRef}`);
  return out;
}
