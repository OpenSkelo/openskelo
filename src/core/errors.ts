export class SkeloError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;

  constructor(message: string, code = "INTERNAL_ERROR", status = 500, details?: Record<string, unknown>) {
    super(message);
    this.name = "SkeloError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function toSkeloError(err: unknown, fallbackCode = "INTERNAL_ERROR", fallbackStatus = 500): SkeloError {
  if (err instanceof SkeloError) return err;
  if (err instanceof Error) return new SkeloError(err.message, fallbackCode, fallbackStatus);
  return new SkeloError(String(err ?? "Unknown error"), fallbackCode, fallbackStatus);
}
