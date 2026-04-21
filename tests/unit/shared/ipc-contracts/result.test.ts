import { describe, expect, test } from "vitest";
import { ok, err, type Result } from "../../../../src/shared/ipc-contracts/result.js";
import { makeError } from "../../../../src/shared/errors/structured.js";

describe("ok / err constructors", () => {
  test("ok wraps data with ok:true discriminator", () => {
    const r = ok({ value: 42 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.value).toBe(42);
    }
  });

  test("err wraps error with ok:false discriminator", () => {
    const error = makeError("test_error", "error");
    const r = err(error);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("test_error");
    }
  });

  test("narrowing via ok discriminator is type-safe", () => {
    function use(r: Result<number>): number {
      if (r.ok) return r.data;
      return -1;
    }
    expect(use(ok(5))).toBe(5);
    expect(use(err(makeError("x", "error")))).toBe(-1);
  });
});
