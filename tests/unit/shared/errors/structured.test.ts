import { describe, expect, test } from "vitest";
import { makeError, fromUnknown } from "../../../../src/shared/errors/structured.js";

describe("makeError", () => {
  test("includes all fields with default empty context", () => {
    const e = makeError("some_code", "error");
    expect(e.code).toBe("some_code");
    expect(e.severity).toBe("error");
    expect(e.context).toEqual({});
  });

  test("carries context through verbatim", () => {
    const e = makeError("resolution_warning", "warning", { dpi: 150 });
    expect(e.context).toEqual({ dpi: 150 });
  });

  test("userMessage is included when provided", () => {
    const e = makeError("x", "error", {}, "Custom text");
    expect(e.userMessage).toBe("Custom text");
  });

  test("userMessage absent when not provided (exactOptionalPropertyTypes)", () => {
    const e = makeError("x", "error");
    expect("userMessage" in e).toBe(false);
  });
});

describe("fromUnknown", () => {
  test("passes through already-structured errors", () => {
    const original = makeError("foo", "error", { x: 1 });
    const result = fromUnknown(original);
    expect(result).toEqual(original);
  });

  test("wraps Error instances with name + message", () => {
    const original = new Error("boom");
    const result = fromUnknown(original, "parse_failed");
    expect(result.code).toBe("parse_failed");
    expect(result.severity).toBe("error");
    expect(result.context).toMatchObject({ name: "Error", message: "boom" });
    expect(result.stack).toBeTruthy();
  });

  test("handles non-Error thrown values", () => {
    const result = fromUnknown("a raw string");
    expect(result.code).toBe("unknown_error");
    expect(result.severity).toBe("error");
    expect(result.context).toEqual({ raw: "a raw string" });
  });

  test("handles null and undefined", () => {
    const nullResult = fromUnknown(null);
    expect(nullResult.code).toBe("unknown_error");
    const undefinedResult = fromUnknown(undefined);
    expect(undefinedResult.code).toBe("unknown_error");
  });

  test("uses custom default code", () => {
    const result = fromUnknown("oops", "csv_parse_error");
    expect(result.code).toBe("csv_parse_error");
  });
});
