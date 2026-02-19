import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { doctorCommand } from "../src/commands/doctor.js";

describe("doctorCommand", () => {
  let dir = "";

  afterEach(() => {
    vi.restoreAllMocks();
    if (dir) rmSync(dir, { recursive: true, force: true });
    delete process.env.MINIMAX_API_KEY;
  });

  it("passes when openai-compatible provider auth succeeds", async () => {
    dir = mkdtempSync(join(tmpdir(), "doctor-ok-"));
    mkdirSync(join(dir, ".skelo"), { recursive: true });
    writeFileSync(
      join(dir, "skelo.yaml"),
      `name: x\nproviders:\n  - name: minimax\n    type: openai\n    url: https://api.minimax.chat/v1\n    env: MINIMAX_API_KEY\nagents:\n  a:\n    role: worker\n    capabilities: [general]\n    provider: minimax\n    model: MiniMax-M2.5\n    max_concurrent: 1\npipelines:\n  p:\n    stages:\n      - name: PENDING\n        transitions: [DONE]\n      - name: DONE\n`
    );

    process.env.MINIMAX_API_KEY = "dummy-key";

    const fetchSpy = vi.spyOn(globalThis, "fetch" as any).mockResolvedValue({ ok: true, status: 200 } as Response);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await doctorCommand({ projectDir: dir });

    expect(fetchSpy).toHaveBeenCalled();
    expect(logSpy.mock.calls.join("\n")).toContain("All provider checks passed");
  });

  it("fails clearly when key is missing", async () => {
    dir = mkdtempSync(join(tmpdir(), "doctor-fail-"));
    writeFileSync(
      join(dir, "skelo.yaml"),
      `name: x\nproviders:\n  - name: minimax\n    type: openai\n    url: https://api.minimax.chat/v1\n    env: MINIMAX_API_KEY\nagents:\n  a:\n    role: worker\n    capabilities: [general]\n    provider: minimax\n    model: MiniMax-M2.5\n    max_concurrent: 1\npipelines:\n  p:\n    stages:\n      - name: PENDING\n        transitions: [DONE]\n      - name: DONE\n`
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await doctorCommand({ projectDir: dir });

    expect(process.exitCode).toBe(1);
    expect(logSpy.mock.calls.join("\n")).toContain("missing API key");
  });
});
