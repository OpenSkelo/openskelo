import type { BlockDef, Edge } from "./block-types.js";

export function topoSort(blocks: BlockDef[], edges: Edge[]): string[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const block of blocks) {
    inDegree.set(block.id, 0);
    adj.set(block.id, []);
  }

  for (const edge of edges) {
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    const neighbors = adj.get(edge.from) ?? [];
    neighbors.push(edge.to);
    adj.set(edge.from, neighbors);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    order.push(cur);
    for (const nxt of adj.get(cur) ?? []) {
      const nextDeg = (inDegree.get(nxt) ?? 0) - 1;
      inDegree.set(nxt, nextDeg);
      if (nextDeg === 0) queue.push(nxt);
    }
  }

  return order;
}

export function suggestClosest(input: string, options: string[]): string | null {
  let best: { value: string; distance: number } | null = null;
  for (const opt of options) {
    const d = levenshtein(input, opt);
    if (!best || d < best.distance) best = { value: opt, distance: d };
  }
  if (!best) return null;
  const threshold = Math.max(1, Math.floor(Math.max(input.length, best.value.length) * 0.4));
  return best.distance <= threshold ? best.value : null;
}

export function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }
  return dp[a.length]![b.length]!;
}

export function isPotentiallyUnsafeRegex(pattern: string): boolean {
  // Heuristic guard: reject nested quantifier groups often associated with catastrophic backtracking.
  // Examples rejected: (a+)+, (.*)+, (\w+)*
  const nestedQuantifierGroup = /\((?:[^()\\]|\\.)*([+*]|\{\d+,?\d*\})(?:[^()\\]|\\.)*\)(?:[+*]|\{\d+,?\d*\})/;
  return nestedQuantifierGroup.test(pattern);
}
