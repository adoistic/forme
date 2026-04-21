// Typed IPC result contract.
// Per docs/eng-plan.md §1 — every IPC handler returns Result<T, StructuredError>.
// Raw throws never cross the IPC boundary; they are caught by the central
// wrapper and converted.

import type { StructuredError } from "../errors/structured.js";

export type Ok<T> = { ok: true; data: T };
export type Err = { ok: false; error: StructuredError };

export type Result<T> = Ok<T> | Err;

export const ok = <T>(data: T): Ok<T> => ({ ok: true, data });
export const err = (error: StructuredError): Err => ({ ok: false, error });
