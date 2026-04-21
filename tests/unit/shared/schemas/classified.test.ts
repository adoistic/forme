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
