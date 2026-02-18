import { parse as parseYaml } from "yaml";

export function parseYamlWithDiagnostics<T = unknown>(raw: string, fileHint = "yaml"): T {
  try {
    return parseYaml(raw) as T;
  } catch (err) {
    const e = err as {
      message?: string;
      linePos?: Array<{ line?: number; col?: number }>;
    };
    const line = e.linePos?.[0]?.line;
    const col = e.linePos?.[0]?.col;
    const where = Number.isFinite(line) && Number.isFinite(col) ? `${fileHint}:${line}:${col}` : fileHint;
    throw new Error(`${where} — ${e.message ?? "Invalid YAML"}`);
  }
}
