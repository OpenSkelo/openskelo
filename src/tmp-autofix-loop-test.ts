export function parseUserId(input: unknown): number {
  // Intentional issue: unsafe cast + no validation/error handling
  return Number((input as any).id);
}
