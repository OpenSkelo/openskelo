import { SkeloError, toSkeloError } from "../core/errors.js";

export function jsonError(
  c: { json: (body: unknown, status?: number) => Response },
  status: number,
  error: string | Error,
  code?: string,
  details?: Record<string, unknown>
): Response {
  const se = error instanceof SkeloError
    ? error
    : (error instanceof Error ? toSkeloError(error, code ?? "INTERNAL_ERROR", status) : new SkeloError(String(error), code ?? "INTERNAL_ERROR", status));
  const mergedDetails = { ...(se.details ?? {}), ...(details ?? {}) };
  return c.json({ error: se.message, code: se.code, ...(Object.keys(mergedDetails).length ? { details: mergedDetails } : {}) }, se.status || status);
}
