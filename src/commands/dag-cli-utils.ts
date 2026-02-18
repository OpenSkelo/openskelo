import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve, basename } from "path";
import { createBlockEngine, type DAGDef, type PortDef } from "../core/block.js";
import { parseYamlWithDiagnostics } from "../core/yaml-utils.js";

const engine = createBlockEngine();

export function resolveDagPath(input: string): string {
  const candidates = [
    resolve(process.cwd(), input),
    resolve(process.cwd(), "pipelines", input),
    resolve(process.cwd(), "examples", input),
    resolve(process.cwd(), "pipelines", `${input}.yaml`),
    resolve(process.cwd(), "examples", `${input}.yaml`),
  ];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  throw new Error(`DAG file not found: '${input}'. Tried current dir, pipelines/, and examples/.`);
}

export function loadDagFromFile(input: string): { dag: DAGDef; path: string; raw: Record<string, unknown> } {
  const path = resolveDagPath(input);
  const raw = parseYamlWithDiagnostics<Record<string, unknown>>(readFileSync(path, "utf-8"), path);
  const dag = engine.parseDAG(raw);
  return { dag, path, raw };
}

export function parseInputPairs(pairs: string[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const pair of pairs ?? []) {
    const idx = pair.indexOf("=");
    if (idx <= 0) throw new Error(`Invalid --input '${pair}'. Use --input key=value`);
    const key = pair.slice(0, idx).trim();
    const raw = pair.slice(idx + 1).trim();
    if (!key) throw new Error(`Invalid --input '${pair}'. Key is empty.`);
    out[key] = coerce(raw);
  }
  return out;
}

function coerce(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if ((raw.startsWith("{") && raw.endsWith("}")) || (raw.startsWith("[") && raw.endsWith("]"))) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

export interface RequiredInput {
  name: string;
  type: PortDef["type"];
  description?: string;
}

export function requiredContextInputs(dag: DAGDef): RequiredInput[] {
  const incoming = new Set(dag.edges.map((e) => `${e.to}::${e.input}`));
  const req = new Map<string, RequiredInput>();

  for (const block of dag.blocks) {
    for (const [portName, def] of Object.entries(block.inputs)) {
      if (!def) continue;
      if (incoming.has(`${block.id}::${portName}`)) continue;
      if (def.required === false || def.default !== undefined) continue;
      if (!req.has(portName)) {
        req.set(portName, { name: portName, type: def.type, description: def.description });
      }
    }
  }

  return [...req.values()];
}

export function missingRequiredInputs(required: RequiredInput[], ctx: Record<string, unknown>): RequiredInput[] {
  return required.filter((r) => ctx[r.name] === undefined);
}

export function ensurePipelinesDir(): string {
  const dir = resolve(process.cwd(), "pipelines");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function normalizeDagFilename(name: string): string {
  const clean = basename(name).replace(/[^a-zA-Z0-9-_]/g, "-");
  return clean.endsWith(".yaml") || clean.endsWith(".yml") ? clean : `${clean}.yaml`;
}
