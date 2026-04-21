// Forme error taxonomy.
// Per docs/eng-plan.md + CEO review Section 5 — all errors use a consistent shape
// and map to user-facing messages via a central registry. i18n-ready even though
// MVP ships in English.

export type ErrorSeverity = "warning" | "error" | "fatal";

/**
 * Structured error crossing the IPC boundary.
 * `code`: stable identifier for programmatic handling + message registry lookup.
 * `context`: structured data for logs (never shown to user directly).
 * `userMessage`: optional override; otherwise resolved from the message registry.
 */
export interface StructuredError {
  code: string;
  severity: ErrorSeverity;
  context: Record<string, unknown>;
  userMessage?: string;
  stack?: string;
}

export function makeError(
  code: string,
  severity: ErrorSeverity,
  context: Record<string, unknown> = {},
  userMessage?: string
): StructuredError {
  return {
    code,
    severity,
    context,
    ...(userMessage !== undefined ? { userMessage } : {}),
  };
}

/**
 * Convert an arbitrary thrown value into a StructuredError.
 * Used by the IPC wrapper so raw throws never cross the boundary.
 */
export function fromUnknown(value: unknown, code = "unknown_error"): StructuredError {
  if (value && typeof value === "object" && "code" in value && "severity" in value) {
    return value as StructuredError;
  }
  if (value instanceof Error) {
    const base: StructuredError = {
      code,
      severity: "error",
      context: { name: value.name, message: value.message },
    };
    if (value.stack !== undefined) base.stack = value.stack;
    return base;
  }
  return {
    code,
    severity: "error",
    context: { raw: String(value) },
  };
}
