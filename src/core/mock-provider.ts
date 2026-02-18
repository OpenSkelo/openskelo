/**
 * Mock provider — simulates agent execution with realistic delays.
 * Used for demos and visual testing of the DAG engine.
 */

import type { ProviderAdapter, DispatchRequest, DispatchResult, DispatchStreamHandlers } from "../types.js";

export interface MockProviderOpts {
  /** Min execution time in ms (default: 2000) */
  minDelay?: number;
  /** Max execution time in ms (default: 5000) */
  maxDelay?: number;
  /** Failure rate 0-1 (default: 0) */
  failureRate?: number;
}

export function createMockProvider(opts: MockProviderOpts = {}): ProviderAdapter {
  const minDelay = opts.minDelay ?? 2000;
  const maxDelay = opts.maxDelay ?? 5000;
  const failureRate = opts.failureRate ?? 0;

  return {
    name: "mock",
    type: "mock",

    async dispatch(request: DispatchRequest): Promise<DispatchResult> {
      const delay = minDelay + Math.random() * (maxDelay - minDelay);
      await new Promise(resolve => setTimeout(resolve, delay));

      // Simulate random failures
      if (Math.random() < failureRate) {
        return {
          success: false,
          error: `Simulated failure for block "${request.title}"`,
        };
      }

      // Generate mock outputs based on the block's expected outputs
      const output = generateMockOutput(request);

      return {
        success: true,
        output: JSON.stringify(output),
        sessionId: `mock_${Date.now()}`,
        tokensUsed: Math.floor(200 + Math.random() * 800),
      };
    },

    async dispatchStream(request: DispatchRequest, handlers?: DispatchStreamHandlers): Promise<DispatchResult> {
      const res = await this.dispatch(request);
      if (res.success && res.output) handlers?.onChunk?.(res.output);
      if (res.success) handlers?.onDone?.(res);
      else handlers?.onError?.(new Error(res.error ?? "dispatch failed"));
      return res;
    },

    async healthCheck(): Promise<boolean> {
      return true;
    },
  };
}

function generateMockOutput(request: DispatchRequest): Record<string, unknown> {
  // Parse expected outputs from the description
  const outputSection = request.description.match(/## Expected Outputs\n([\s\S]*?)(?:\n##|$)/);
  if (!outputSection) {
    return { result: `Completed: ${request.title}` };
  }

  const outputs: Record<string, unknown> = {};
  const lines = outputSection[1].split("\n").filter(l => l.startsWith("- **"));

  for (const line of lines) {
    const match = line.match(/\*\*(\w+)\*\*\s*\((\w+)\)/);
    if (!match) continue;
    const [, name, type] = match;

    switch (type) {
      case "string":
        outputs[name] = `Mock ${name} output for "${request.title}" — generated at ${new Date().toISOString()}. `.repeat(8) +
          `This is a comprehensive simulated output demonstrating the block execution pipeline. The agent processed all inputs and produced this result after careful analysis. ` +
          `Key findings include multiple relevant data points that satisfy the quality criteria defined in the post-gates.`;
        break;
      case "number":
        outputs[name] = Math.floor(Math.random() * 100);
        break;
      case "boolean":
        outputs[name] = true;
        break;
      case "json":
        outputs[name] = [{ item: `mock_${name}_1`, status: "ok" }, { item: `mock_${name}_2`, status: "ok" }];
        break;
      case "artifact":
        outputs[name] = `<html><body><h1>${request.title}</h1><p>Mock artifact generated</p></body></html>`;
        break;
      default:
        outputs[name] = `mock_${name}`;
    }
  }

  return Object.keys(outputs).length > 0 ? outputs : { result: `Completed: ${request.title}` };
}
