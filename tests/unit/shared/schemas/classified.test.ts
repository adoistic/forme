import { describe, expect, test } from "vitest";
import {
  ClassifiedTypeSchema,
  FieldSchemaByType,
  validateClassified,
} from "../../../../src/shared/schemas/classified.js";

describe("ClassifiedTypeSchema", () => {
  test("accepts all 12 canonical types", () => {
    const types = [
      "matrimonial_with_photo",
      "matrimonial_no_photo",
      "job_vacancy",
      "job_wanted",
      "property_sale",
      "property_rent",
      "obituary",
      "public_notice",
      "announcement",
      "tender_notice",
      "education",
      "vehicles",
    ];
    for (const t of types) {
      expect(() => ClassifiedTypeSchema.parse(t)).not.toThrow();
    }
  });

  test("rejects unknown types", () => {
    expect(() => ClassifiedTypeSchema.parse("lost_and_found")).toThrow();
  });

  test("FieldSchemaByType has exactly 12 entries matching the enum", () => {
    expect(Object.keys(FieldSchemaByType).sort()).toEqual(
      ClassifiedTypeSchema.options.slice().sort()
    );
  });
});

describe("validateClassified — per-type", () => {
  test("matrimonial_with_photo: minimal valid", () => {
    const r = validateClassified("matrimonial_with_photo", {
      name: "Aanya Sharma",
      location: "Mumbai",
      contact_name: "Father",
      contact_phones: ["+91 98765 43210"],
    });
    expect(r.ok).toBe(true);
  });

  test("matrimonial_with_photo: missing required field is rejected", () => {
    const r = validateClassified("matrimonial_with_photo", {
      name: "Aanya",
      // no location, no contact_name
      contact_phones: ["+91 12345 67890"],
    });
    expect(r.ok).toBe(false);
  });

  test("matrimonial_with_photo: invalid phone format", () => {
    const r = validateClassified("matrimonial_with_photo", {
      name: "Aanya",
      location: "Mumbai",
      contact_name: "Father",
      contact_phones: ["abc"], // no digits
    });
    expect(r.ok).toBe(false);
  });

  test("obituary: minimal valid", () => {
    const r = validateClassified("obituary", {
      name_of_deceased: "Ram Prasad",
      date_of_death: "2026-04-15",
    });
    expect(r.ok).toBe(true);
  });

  test("public_notice: valid with legal notice body", () => {
    const r = validateClassified("public_notice", {
      notice_type: "legal_notice",
      notice_text:
        "This is a legal notice concerning a property dispute. Full text of the notice goes here.",
      published_by: "Advocate X",
      date: "2026-04-21",
    });
    expect(r.ok).toBe(true);
  });

  test("public_notice: oversize notice_text (>4000) is rejected", () => {
    const longText = "a".repeat(4001);
    const r = validateClassified("public_notice", {
      notice_type: "other",
      notice_text: longText,
      published_by: "Someone",
      date: "2026-04-21",
    });
    expect(r.ok).toBe(false);
  });

  test("announcement: minimal valid", () => {
    const r = validateClassified("announcement", {
      occasion_type: "birthday",
      message_text: "Happy 80th birthday!",
      sender_names: ["Family"],
    });
    expect(r.ok).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────
  // Price-style fields are intentionally z.string() so operators can
  // write "Rs 8.5 lakh" / "Negotiable" / "₹14,00,000" / "20k". The
  // CSV importer must NOT coerce these via Number().
  //
  // Regression for the silent-drop bug fixed in commit 5633965:
  // numericKeys had stale entries for expected_price / asking_price /
  // rent_amount, so natural-language prices became NaN and got dropped.
  // ─────────────────────────────────────────────────────────────────

  test("vehicles: expected_price accepts natural-language string 'Rs 8.5 lakh'", () => {
    const r = validateClassified("vehicles", {
      make: "Maruti",
      model: "Swift",
      year: 2018,
      kilometers: 42500,
      fuel_type: "petrol",
      expected_price: "Rs 8.5 lakh",
      location: "Pune",
      contact_phones: ["+91 98765 43210"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toMatchObject({ expected_price: "Rs 8.5 lakh" });
    }
  });

  test("vehicles: expected_price accepts pure-numeric string '850000'", () => {
    // Pre-fix, the importer would coerce "850000" → 850000 (Number),
    // then Zod would reject "expected string, received number".
    // Post-fix, the importer leaves the cell as a string and Zod accepts it.
    const r = validateClassified("vehicles", {
      make: "Honda",
      model: "City",
      year: 2020,
      location: "Mumbai",
      contact_phones: ["+91 98765 11111"],
      expected_price: "850000",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toMatchObject({ expected_price: "850000" });
    }
  });

  test("vehicles: expected_price rejects a number type (must be string)", () => {
    // Locks the contract: even if a programmatic caller passes a number,
    // the schema requires string. CSV import must coerce upstream.
    const r = validateClassified("vehicles", {
      make: "Toyota",
      model: "Innova",
      year: 2019,
      location: "Bengaluru",
      contact_phones: ["+91 98765 22222"],
      expected_price: 1400000 as unknown as string, // intentional type lie
    });
    expect(r.ok).toBe(false);
  });

  test("property_rent: monthly_rent + security_deposit accept strings like 'Rs 40,000/month'", () => {
    const r = validateClassified("property_rent", {
      property_type: "residential",
      location: "Indiranagar, Bengaluru",
      contact_phones: ["+91 98765 33333"],
      monthly_rent: "Rs 40,000/month",
      security_deposit: "Rs 2,00,000",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toMatchObject({
        monthly_rent: "Rs 40,000/month",
        security_deposit: "Rs 2,00,000",
      });
    }
  });

  test("property_sale: expected_price accepts label like 'Negotiable'", () => {
    const r = validateClassified("property_sale", {
      property_type: "commercial",
      location: "DLF Phase 2, Gurugram",
      contact_phones: ["+91 98765 44444"],
      expected_price: "Negotiable",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toMatchObject({ expected_price: "Negotiable" });
    }
  });

  test("property_sale: minimal valid", () => {
    const r = validateClassified("property_sale", {
      property_type: "residential",
      location: "Bangalore",
      contact_phones: ["+91 98765 00000"],
    });
    expect(r.ok).toBe(true);
  });

  test("property_sale: rejects missing property_type", () => {
    const r = validateClassified("property_sale", {
      location: "Bangalore",
      contact_phones: ["+91 98765 00000"],
    });
    expect(r.ok).toBe(false);
  });

  test("vehicles: year bounds enforced", () => {
    const r1 = validateClassified("vehicles", {
      make: "Toyota",
      model: "Camry",
      year: 1900, // below 1920
      location: "Delhi",
      contact_phones: ["+91 12345 67890"],
    });
    expect(r1.ok).toBe(false);

    const r2 = validateClassified("vehicles", {
      make: "Toyota",
      model: "Camry",
      year: 2022,
      location: "Delhi",
      contact_phones: ["+91 12345 67890"],
    });
    expect(r2.ok).toBe(true);
  });

  test("job_vacancy: email validated when provided", () => {
    const r1 = validateClassified("job_vacancy", {
      job_title: "Engineer",
      company_name: "Co",
      location: "Pune",
      contact_phones: ["+91 11111 11111"],
      contact_email: "not-an-email",
    });
    expect(r1.ok).toBe(false);

    const r2 = validateClassified("job_vacancy", {
      job_title: "Engineer",
      company_name: "Co",
      location: "Pune",
      contact_phones: ["+91 11111 11111"],
      contact_email: "hr@company.com",
    });
    expect(r2.ok).toBe(true);
  });

  test("tender_notice: requires deadline", () => {
    const r = validateClassified("tender_notice", {
      tender_title: "Road repair",
      issuing_authority: "Municipal Corp",
      contact: "Public Works Department",
      // missing submission_deadline
    });
    expect(r.ok).toBe(false);
  });
});
