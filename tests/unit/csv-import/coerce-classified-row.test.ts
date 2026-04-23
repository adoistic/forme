import { describe, expect, test } from "vitest";
import { coerceClassifiedRowFields } from "../../../src/main/csv-import/coerce-classified-row.js";

/**
 * The NUMERIC_KEYS list inside coerce-classified-row.ts MUST match the z.number()
 * declarations in src/shared/schemas/classified.ts. If you add a numeric field
 * there, add it here too — and add a test below.
 *
 * Most "amount" fields (expected_price, monthly_rent, security_deposit) are
 * z.string() so operators can write "₹8.5 lakh" / "Negotiable" / "20k". They
 * MUST NOT be in NUMERIC_KEYS or they get silently dropped at import.
 */

describe("coerceClassifiedRowFields", () => {
  test("vehicles: string-typed expected_price preserved as 'Rs. 8.5 lakh'", () => {
    const out = coerceClassifiedRowFields({
      make: "Maruti",
      model: "Swift",
      year: "2018",
      expected_price: "Rs. 8.5 lakh",
      location: "Pune",
      contact_phones: "+91 98765 43210",
    });
    expect(out["expected_price"]).toBe("Rs. 8.5 lakh");
  });

  test("vehicles: year + kilometers coerced to numbers", () => {
    const out = coerceClassifiedRowFields({
      year: "2018",
      kilometers: "42500",
    });
    expect(out["year"]).toBe(2018);
    expect(out["kilometers"]).toBe(42500);
  });

  test("vehicles: year='not a year' silently dropped (Zod will reject downstream)", () => {
    const out = coerceClassifiedRowFields({
      year: "not a year",
      make: "Maruti",
    });
    expect(out["year"]).toBeUndefined();
    expect(out["make"]).toBe("Maruti");
  });

  test("property_sale: expected_price='Negotiable' preserved as string", () => {
    const out = coerceClassifiedRowFields({
      property_type: "residential",
      bedrooms: "3",
      expected_price: "Negotiable",
      location: "Bandra West, Mumbai",
    });
    expect(out["expected_price"]).toBe("Negotiable");
    expect(out["bedrooms"]).toBe(3);
  });

  test("property_rent: monthly_rent + security_deposit preserved as strings", () => {
    const out = coerceClassifiedRowFields({
      property_type: "residential",
      monthly_rent: "Rs. 45,000/month",
      security_deposit: "3 months advance",
      location: "Indiranagar, Bangalore",
    });
    expect(out["monthly_rent"]).toBe("Rs. 45,000/month");
    expect(out["security_deposit"]).toBe("3 months advance");
  });

  test("matrimonial: age=29 coerced to number 29", () => {
    const out = coerceClassifiedRowFields({
      name: "Aanya Sharma",
      age: "29",
      location: "Mumbai",
    });
    expect(out["age"]).toBe(29);
  });

  test("arrays: contact_phones split on semicolons + trimmed", () => {
    const out = coerceClassifiedRowFields({
      contact_phones: "+91 98765 43210; +91 87654 32109 ; +91 76543 21098",
    });
    expect(out["contact_phones"]).toEqual([
      "+91 98765 43210",
      "+91 87654 32109",
      "+91 76543 21098",
    ]);
  });

  test("arrays: sender_names split on commas + trimmed, empty entries dropped", () => {
    const out = coerceClassifiedRowFields({
      sender_names: "Sharma family, Mehta family ,, Patel family",
    });
    expect(out["sender_names"]).toEqual(["Sharma family", "Mehta family", "Patel family"]);
  });

  test("standard envelope keys (type, language, weeks_to_run, billing_reference, photo_path) are skipped", () => {
    const out = coerceClassifiedRowFields({
      type: "vehicles",
      language: "en",
      weeks_to_run: "2",
      billing_reference: "INV-001",
      photo_path: "/tmp/photo.jpg",
      make: "Honda",
    });
    expect(out["type"]).toBeUndefined();
    expect(out["language"]).toBeUndefined();
    expect(out["weeks_to_run"]).toBeUndefined();
    expect(out["billing_reference"]).toBeUndefined();
    expect(out["photo_path"]).toBeUndefined();
    expect(out["make"]).toBe("Honda");
  });

  test("empty / whitespace-only / null / undefined cells are skipped", () => {
    const out = coerceClassifiedRowFields({
      make: "Honda",
      model: "",
      location: "   ",
      expected_price: undefined,
      kilometers: null,
    });
    expect(out["make"]).toBe("Honda");
    expect(out["model"]).toBeUndefined();
    expect(out["location"]).toBeUndefined();
    expect(out["expected_price"]).toBeUndefined();
    expect(out["kilometers"]).toBeUndefined();
  });

  test("regression: '₹8.5 lakh' is NaN under Number() yet preserved as string (the original bug)", () => {
    // Confirm the precondition that triggered the original bug.
    expect(Number.isNaN(Number("₹8.5 lakh"))).toBe(true);

    // Confirm the field survives coercion as the literal string the
    // operator wrote — instead of being silently dropped.
    const out = coerceClassifiedRowFields({
      expected_price: "₹8.5 lakh",
    });
    expect(out["expected_price"]).toBe("₹8.5 lakh");
  });
});
