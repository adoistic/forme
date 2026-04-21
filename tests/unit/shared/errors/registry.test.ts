import { describe, expect, test } from "vitest";
import { resolveMessage, errorMessages } from "../../../../src/shared/errors/registry.js";

describe("error registry resolveMessage", () => {
  test("returns unknown_error fallback for unknown codes", () => {
    const msg = resolveMessage("code_that_does_not_exist_in_registry");
    expect(msg).toBe(errorMessages["unknown_error"]);
  });

  test("returns literal message when no placeholders", () => {
    const msg = resolveMessage("corrupt_archive");
    expect(msg).toBe("This file looks corrupted. Try re-exporting from Word.");
  });

  test("substitutes single placeholder", () => {
    const msg = resolveMessage("resolution_warning", { dpi: 150 });
    expect(msg).toContain("150 DPI");
  });

  test("substitutes multiple placeholders", () => {
    const msg = resolveMessage("ad_aspect_mismatch", {
      expected_aspect: "1:2",
      actual_aspect: "4:3",
    });
    expect(msg).toContain("1:2");
    expect(msg).toContain("4:3");
  });

  test("leaves unresolved placeholder visible when key missing", () => {
    const msg = resolveMessage("resolution_warning", {}); // no dpi
    expect(msg).toContain("{dpi}");
  });

  test("every registered error code has a non-empty message", () => {
    for (const [code, template] of Object.entries(errorMessages)) {
      expect(template, `empty message for code=${code}`).toBeTruthy();
      expect(template.length, `message too short for code=${code}`).toBeGreaterThan(3);
    }
  });

  test("critical Forme errors are registered", () => {
    // Sanity: the errors named in CEO plan + eng plan should all exist.
    const required = [
      "font_not_loaded",
      "ooxml_validation_error",
      "db_corrupt",
      "libreoffice_not_installed",
      "encoding_error",
      "ad_aspect_mismatch",
      "no_viable_template",
      "entry_too_tall",
      "blob_hash_mismatch",
    ];
    for (const code of required) {
      expect(errorMessages[code], `missing required error code: ${code}`).toBeTruthy();
    }
  });
});
