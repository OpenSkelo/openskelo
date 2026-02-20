import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { evaluateBlockGate, evaluateBlockGates, evaluateSafeExpression, type BlockGate } from "@openskelo/gates";

describe("@openskelo/gates package", () => {
  it("evaluates expr gates", () => {
    expect(evaluateSafeExpression("inputs.a + outputs.b", { inputs: { a: 2 }, outputs: { b: 3 } })).toBe(5);

    const gate: BlockGate = {
      name: "expr-pass",
      error: "expr failed",
      check: { type: "expr", expression: "inputs.a === 1 && outputs.ok === true" },
    };

    const result = evaluateBlockGate(gate, { a: 1 }, { ok: true });
    expect(result.passed).toBe(true);
  });

  it("evaluates json_schema/diff/http/cost/latency gates", async () => {
    const schemaGate: BlockGate = {
      name: "schema",
      error: "schema failed",
      check: {
        type: "json_schema",
        port: "payload",
        schema: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
      },
    };
    expect(evaluateBlockGate(schemaGate, {}, { payload: { name: "nora" } }).passed).toBe(true);

    const diffGate: BlockGate = {
      name: "diff",
      error: "diff failed",
      check: { type: "diff", left: "a", right: "b", mode: "not_equal" },
    };
    expect(evaluateBlockGate(diffGate, { a: 1 }, { b: 2 }).passed).toBe(true);

    const testPort = 28000 + Math.floor(Math.random() * 1000);
    const server = spawn(
      process.execPath,
      [
        "-e",
        "const http=require('node:http'); const port=Number(process.env.PORT); http.createServer((_req,res)=>{res.statusCode=204;res.end('ok');}).listen(port,'127.0.0.1',()=>{process.stdout.write('READY\\n');});",
      ],
      {
        env: { ...process.env, PORT: String(testPort) },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("http test server did not start in time")), 3000);
      server.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`http test server exited early (${code ?? "unknown"})`));
      });
      server.stdout?.on("data", (chunk: Buffer) => {
        if (String(chunk).includes("READY")) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    try {
      const httpGate: BlockGate = {
        name: "http",
        error: "http failed",
        check: { type: "http", url: `http://127.0.0.1:${testPort}/health`, expect_status: 204, timeout_ms: 3000 },
      };
      expect(evaluateBlockGate(httpGate, {}, {}).passed).toBe(true);
    } finally {
      server.kill("SIGTERM");
    }

    const costGate: BlockGate = {
      name: "cost",
      error: "cost failed",
      check: { type: "cost", max: 10, port: "__cost" },
    };
    expect(evaluateBlockGate(costGate, {}, { __cost: 9 }).passed).toBe(true);

    const latencyGate: BlockGate = {
      name: "latency",
      error: "latency failed",
      check: { type: "latency", max_ms: 100, port: "__latency_ms" },
    };
    expect(evaluateBlockGate(latencyGate, {}, { __latency_ms: 80 }).passed).toBe(true);
  });

  it("fails safely for invalid regex and disabled shell gates", () => {
    const regexGate: BlockGate = {
      name: "regex",
      error: "regex failed",
      check: { type: "port_matches", port: "x", pattern: "(" },
    };
    const regexResult = evaluateBlockGate(regexGate, {}, { x: "abc" });
    expect(regexResult.passed).toBe(false);
    expect(String(regexResult.audit?.failure ?? "")).toContain("invalid_regex");

    const previous = process.env.OPENSKELO_ALLOW_SHELL_GATES;
    process.env.OPENSKELO_ALLOW_SHELL_GATES = "false";
    const shellGate: BlockGate = {
      name: "shell",
      error: "shell failed",
      check: { type: "shell", command: "echo hi" },
    };
    const shellResult = evaluateBlockGate(shellGate, {}, {});
    expect(shellResult.passed).toBe(false);
    expect(String(shellResult.audit?.status ?? "")).toBe("blocked");
    if (previous === undefined) delete process.env.OPENSKELO_ALLOW_SHELL_GATES;
    else process.env.OPENSKELO_ALLOW_SHELL_GATES = previous;
  });

  it("handles llm_review via shared runtime", async () => {
    const gates: BlockGate[] = [
      {
        name: "review",
        error: "review failed",
        check: { type: "llm_review", port: "default", criteria: ["mentions tests"] },
      },
    ];

    const results = await evaluateBlockGates(gates, {
      inputs: {},
      outputs: { default: "hello" },
      llmReview: async () => ({
        success: true,
        output: JSON.stringify([{ criterion: "mentions tests", passed: true, reasoning: "ok" }]),
      }),
    });

    expect(results[0].passed).toBe(true);
  });
});
