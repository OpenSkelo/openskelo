import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const reportsDir = resolve(process.cwd(), "docs", "reports");
mkdirSync(reportsDir, { recursive: true });

const vitestPath = resolve(reportsDir, "vitest-results.json");
const coveragePath = resolve(reportsDir, "coverage", "coverage-summary.json");
const machinePath = resolve(reportsDir, "test-summary.json");
const humanPath = resolve(reportsDir, "test-summary.md");

const vitest = JSON.parse(readFileSync(vitestPath, "utf8"));
const coverage = JSON.parse(readFileSync(coveragePath, "utf8"));

const files = vitest.testResults ?? [];
const categoryCounts = {
  creation_validation: countByName(files, /run creation \+ validation/i),
  transitions_gates: countByName(files, /deterministic transitions \+ gates/i),
  context_artifacts_integrity: countByName(files, /shared context \+ artifacts \+ run_steps integrity/i),
  integration_reliability: countByName(files, /integration flow and reliability edge cases/i),
};

const machine = {
  generated_at: new Date().toISOString(),
  totals: {
    test_files: vitest.numTotalTestSuites,
    tests: vitest.numTotalTests,
    passed: vitest.numPassedTests,
    failed: vitest.numFailedTests,
    pending: vitest.numPendingTests,
  },
  categories: categoryCounts,
  coverage: coverage.total,
  known_gaps: [
    "No concurrency race-condition tests around simultaneous /step requests",
    "No filesystem fault injection tests for artifact persistence failures",
    "Task-engine gate matrix has baseline coverage but lacks fuzz-style payload exploration",
  ],
  risks: [
    {
      area: "Concurrent step mutations",
      severity: "medium",
      probability: "medium",
      mitigation: "Add lock/transaction + concurrent integration tests",
    },
    {
      area: "Artifact write failure handling",
      severity: "medium",
      probability: "low",
      mitigation: "Add explicit recoverable error path and tests",
    },
    {
      area: "Backward compatibility drift in run payloads",
      severity: "high",
      probability: "low",
      mitigation: "Add contract snapshots for /api/runs and /api/runs/:id/steps",
    },
  ],
  recommendations_next_iteration: [
    "Introduce explicit idempotency keys for /api/runs/:id/step and verify duplicate-request semantics",
    "Wrap run state+step writes in a single transactional boundary with optimistic concurrency fields",
    "Add API contract snapshot tests to enforce backward-compatible response schemas",
  ],
};

writeFileSync(machinePath, JSON.stringify(machine, null, 2));

const md = `# OpenSkelo Test Report\n\nGenerated: ${machine.generated_at}\n\n## Totals\n- Test files: ${machine.totals.test_files}\n- Tests: ${machine.totals.tests}\n- Passed: ${machine.totals.passed}\n- Failed: ${machine.totals.failed}\n- Pending: ${machine.totals.pending}\n\n## Pass/Fail by Category\n- Run creation + validation: ${formatCategory(machine.categories.creation_validation)}\n- Deterministic transitions + gates: ${formatCategory(machine.categories.transitions_gates)}\n- Shared context/artifact/run_steps integrity: ${formatCategory(machine.categories.context_artifacts_integrity)}\n- Integration + reliability edge cases: ${formatCategory(machine.categories.integration_reliability)}\n\n## Coverage (total)\n- Lines: ${pct(machine.coverage.lines)}\n- Statements: ${pct(machine.coverage.statements)}\n- Functions: ${pct(machine.coverage.functions)}\n- Branches: ${pct(machine.coverage.branches)}\n\n## Known Gaps\n${machine.known_gaps.map((g) => `- ${g}`).join("\n")}\n\n## Risk Matrix\n| Area | Severity | Probability | Mitigation |\n|---|---|---|---|\n${machine.risks.map((r) => `| ${r.area} | ${r.severity} | ${r.probability} | ${r.mitigation} |`).join("\n")}\n\n## Recommendations (Next Iteration)\n${machine.recommendations_next_iteration.map((r) => `1. ${r}`).join("\n")}\n`;

writeFileSync(humanPath, md);
console.log(`Wrote ${machinePath}`);
console.log(`Wrote ${humanPath}`);

function pct(metric) {
  return `${metric.pct}% (${metric.covered}/${metric.total})`;
}

function countByName(files, pattern) {
  const tests = files.flatMap((f) => f.assertionResults ?? []);
  const filtered = tests.filter((t) => pattern.test(t.ancestorTitles?.join(" ") ?? ""));
  return {
    total: filtered.length,
    passed: filtered.filter((t) => t.status === "passed").length,
    failed: filtered.filter((t) => t.status === "failed").length,
    pending: filtered.filter((t) => t.status === "pending").length,
  };
}

function formatCategory(c) {
  return `${c.passed}/${c.total} passed (${c.failed} failed, ${c.pending} pending)`;
}
