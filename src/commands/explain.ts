import chalk from "chalk";
import type { DAGDef } from "../core/block.js";
import { loadConfig } from "../core/config.js";
import { loadDagFromFile, requiredContextInputs } from "./dag-cli-utils.js";

export async function explainCommand(dagFile: string): Promise<void> {
  try {
    const { dag, path } = loadDagFromFile(dagFile);
    const layers = topoLayers(dag);
    let cfg: ReturnType<typeof loadConfig> | null = null;
    try { cfg = loadConfig(); } catch { cfg = null; }

    console.log(chalk.bold(`${dag.name} — ${dag.blocks.length} blocks, ${dag.edges.length} edges`));
    console.log(chalk.dim(path));
    console.log();
    console.log(chalk.cyan("Execution order:"));

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      const parallel = layer.length > 1 ? chalk.yellow(" (parallel)") : "";
      console.log(`Layer ${i + 1}:${parallel} ${layer.join(", ")}`);
      for (const blockId of layer) {
        const block = dag.blocks.find((b) => b.id === blockId);
        if (!block) continue;
        const inputLines = Object.keys(block.inputs).map((port) => {
          const incoming = dag.edges.find((e) => e.to === block.id && e.input === port);
          if (incoming) return `    ${port} ← ${incoming.from}.${incoming.output}`;
          const def = block.inputs[port];
          if (!def) return `    ${port} ← context`;
          const req = def.required === false || def.default !== undefined ? "optional" : "required";
          return `    ${port} ← context (${req})`;
        });
        if (inputLines.length) {
          console.log(`  ${block.id} inputs:`);
          for (const l of inputLines) console.log(l);
        }
        const routing = resolveRoutingLine(block, cfg);
        if (routing) console.log(`  ${block.id} route: ${routing}`);
      }
    }

    const totalPre = dag.blocks.reduce((n, b) => n + b.pre_gates.length, 0);
    const totalPost = dag.blocks.reduce((n, b) => n + b.post_gates.length, 0);
    const approvals = dag.blocks.filter((b) => b.approval?.required === true).map((b) => b.id);
    const bounces = dag.blocks.flatMap((b) => (b.on_gate_fail ?? []).map((r) => `${b.id}→${r.route_to}`));

    console.log();
    console.log(`Gates: ${totalPre + totalPost} total (${totalPre} pre, ${totalPost} post)`);
    console.log(`Approval checkpoints: ${approvals.length}${approvals.length ? ` (${approvals.join(", ")})` : ""}`);
    console.log(`Bounce routes: ${bounces.length}${bounces.length ? ` (${bounces.join(", ")})` : ""}`);

    const required = requiredContextInputs(dag);
    console.log();
    if (!required.length) {
      console.log(chalk.green("Required context inputs: none"));
    } else {
      console.log(chalk.cyan("Required context inputs:"));
      for (const r of required) {
        console.log(`  - ${r.name} (${r.type})${r.description ? ` — ${r.description}` : ""}`);
      }
    }
  } catch (err) {
    console.error(chalk.red(`✗ ${String((err as Error).message ?? err)}`));
    process.exit(1);
  }
}

function resolveRoutingLine(block: { agent?: { specific?: string; role?: string; capability?: string } }, cfg: ReturnType<typeof loadConfig> | null): string {
  const a = block.agent ?? {};
  if (!cfg) return a.specific ? `specific:${a.specific}` : (a.role ? `role:${a.role}` : (a.capability ? `capability:${a.capability}` : "default"));

  const agents = cfg.agents;
  let selectedId: string | null = null;
  let reason = "";
  if (a.specific && agents[a.specific]) {
    selectedId = a.specific;
    reason = "specific";
  } else if (a.role) {
    selectedId = Object.keys(agents).find((id) => agents[id]?.role === a.role) ?? null;
    if (selectedId) reason = `role:${a.role}`;
  }
  if (!selectedId && a.capability) {
    selectedId = Object.keys(agents).find((id) => Array.isArray(agents[id]?.capabilities) && agents[id].capabilities.includes(a.capability!)) ?? null;
    if (selectedId) reason = `capability:${a.capability}`;
  }
  if (!selectedId) {
    selectedId = Object.keys(agents)[0] ?? null;
    if (selectedId) reason = "default:first-agent";
  }
  if (!selectedId || !agents[selectedId]) return "unresolved";
  const agent = agents[selectedId];
  return `${selectedId} via ${reason} → provider=${agent.provider}, model=${agent.model}`;
}

function topoLayers(dag: DAGDef): string[][] {
  const inDeg = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const b of dag.blocks) {
    inDeg.set(b.id, 0);
    out.set(b.id, []);
  }
  for (const e of dag.edges) {
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
    out.get(e.from)?.push(e.to);
  }

  let queue = [...inDeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const layers: string[][] = [];
  while (queue.length) {
    const layer = [...queue];
    layers.push(layer);
    const next: string[] = [];
    for (const id of layer) {
      for (const n of out.get(id) ?? []) {
        inDeg.set(n, (inDeg.get(n) ?? 1) - 1);
        if ((inDeg.get(n) ?? 0) === 0) next.push(n);
      }
    }
    queue = next;
  }
  return layers;
}
