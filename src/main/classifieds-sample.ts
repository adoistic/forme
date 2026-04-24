// Sample CSV used by the "Download sample CSV" button on ClassifiedsScreen
// (T16). One representative row per classified type. The header row contains
// every column any type might use; each row leaves columns it doesn't need
// blank. Built programmatically so column counts always line up — the
// existing CSV import handler rejects ragged rows.

import type { ClassifiedType } from "@shared/schemas/classified.js";

// Per-type column reference. The order matches the cells emitted in
// SAMPLE_ROWS below; the union becomes the CSV header.
const STANDARD_COLUMNS = ["type", "language", "weeks_to_run", "billing_reference"] as const;

// Per-type field column lists — kept in lockstep with src/shared/schemas/
// classified.ts. When a new field is added there, mirror it here.
export const COLUMNS_BY_TYPE: Record<ClassifiedType, readonly string[]> = {
  matrimonial_with_photo: [
    "name",
    "age",
    "height",
    "religion_community",
    "mother_tongue",
    "education",
    "occupation",
    "income",
    "location",
    "marital_status",
    "family_details",
    "requirements",
    "contact_name",
    "contact_phones",
    "contact_email",
    "photo_path",
  ],
  matrimonial_no_photo: [
    "name",
    "age",
    "height",
    "religion_community",
    "mother_tongue",
    "education",
    "occupation",
    "income",
    "location",
    "marital_status",
    "family_details",
    "requirements",
    "contact_name",
    "contact_phones",
    "contact_email",
  ],
  job_vacancy: [
    "job_title",
    "company_name",
    "location",
    "qualifications",
    "experience_required",
    "salary_range",
    "contact_phones",
    "contact_email",
    "walk_in_datetime",
    "application_deadline",
    "how_to_apply",
  ],
  job_wanted: [
    "candidate_name",
    "age",
    "qualifications",
    "experience",
    "location_preferences",
    "willing_to_relocate",
    "contact_phones",
    "pitch",
  ],
  property_sale: [
    "property_type",
    "bedrooms",
    "built_up_area_sqft",
    "plot_area_sqft",
    "location",
    "key_features",
    "contact_phones",
    "expected_price",
  ],
  property_rent: [
    "property_type",
    "bedrooms",
    "built_up_area_sqft",
    "plot_area_sqft",
    "location",
    "key_features",
    "contact_phones",
    "monthly_rent",
    "security_deposit",
    "available_from",
    "furnishing",
    "preferred_tenants",
  ],
  obituary: [
    "name_of_deceased",
    "date_of_death",
    "age",
    "life_summary",
    "surviving_family",
    "prayer_meeting",
    "contact_for_condolences",
  ],
  public_notice: ["notice_type", "notice_text", "published_by", "date"],
  announcement: ["occasion_type", "recipient_name", "message_text", "sender_names"],
  tender_notice: [
    "tender_title",
    "issuing_authority",
    "tender_id",
    "scope",
    "eligibility",
    "submission_deadline",
    "contact",
  ],
  education: ["institution_name", "courses_offered", "batch_start", "contact_phones", "location"],
  vehicles: [
    "make",
    "model",
    "year",
    "kilometers",
    "fuel_type",
    "expected_price",
    "location",
    "contact_phones",
  ],
};

// Sample values for each type (covers every required field + a sampling
// of optional ones so the operator can copy + tweak).
const SAMPLE_FIELDS: Record<ClassifiedType, Record<string, string>> = {
  matrimonial_with_photo: {
    name: "Aanya Sharma",
    age: "28",
    location: "Mumbai",
    religion_community: "Hindu",
    education: "MBA",
    occupation: "Product Manager",
    contact_name: "Priya Sharma",
    contact_phones: "+91 98765 43210",
    contact_email: "priya@example.com",
  },
  matrimonial_no_photo: {
    name: "Rohan Gupta",
    age: "30",
    location: "Delhi",
    religion_community: "Hindu",
    education: "B.Tech",
    occupation: "Software Engineer",
    contact_name: "Father",
    contact_phones: "+91 98765 43211",
  },
  job_vacancy: {
    job_title: "Senior Frontend Engineer",
    company_name: "Acme Corp",
    location: "Bengaluru",
    qualifications: "B.Tech / B.E. Computer Science",
    experience_required: "5+ years",
    salary_range: "12-18 LPA",
    contact_phones: "+91 98765 43212",
    contact_email: "hr@acme.com",
    how_to_apply: "Email resume to hr@acme.com",
  },
  job_wanted: {
    candidate_name: "Vikas Singh",
    qualifications: "B.Com",
    experience: "3 years in retail accounting",
    location_preferences: "Pune or Mumbai",
    contact_phones: "+91 98765 43213",
  },
  property_sale: {
    property_type: "residential",
    bedrooms: "3",
    built_up_area_sqft: "1450",
    location: "Gurugram",
    key_features: "East-facing 3 BHK in DLF Phase 2",
    contact_phones: "+91 98765 43214",
    expected_price: "1.85 cr",
  },
  property_rent: {
    property_type: "residential",
    bedrooms: "2",
    built_up_area_sqft: "950",
    location: "Bandra West",
    key_features: "Sea-facing semi-furnished apartment",
    contact_phones: "+91 98765 43215",
    monthly_rent: "75000",
    security_deposit: "150000",
    furnishing: "semi",
    preferred_tenants: "family",
    available_from: "2026-05-01",
  },
  obituary: {
    name_of_deceased: "Ram Prasad",
    date_of_death: "2026-04-15",
    age: "82",
    life_summary: "Beloved father and husband; survived by family.",
    surviving_family: "Wife Kamla; sons Ravi and Arun",
    prayer_meeting: "Prayer meeting Tuesday 11am at home",
  },
  public_notice: {
    notice_type: "name_change",
    notice_text:
      "I, Kavita Mehta, daughter of Suresh Mehta, hereby announce I have changed my name to Kavita Sharma.",
    published_by: "Kavita Sharma",
    date: "2026-04-20",
  },
  announcement: {
    occasion_type: "birthday",
    recipient_name: "Riya",
    message_text: "Wishing you a joyous 30th birthday and a year filled with love.",
    sender_names: "Mom; Dad; Aanya",
  },
  tender_notice: {
    tender_title: "Construction of Community Health Centre",
    issuing_authority: "Public Works Dept",
    tender_id: "PWD-2026-417",
    scope: "Civil works for 30-bed CHC; site visit mandatory",
    eligibility: "Class A registered contractors only",
    submission_deadline: "2026-05-15",
    contact: "Office of Executive Engineer; +91 11 12345 6789",
  },
  education: {
    institution_name: "Aakash Coaching Centre",
    courses_offered: "JEE / NEET preparation; Foundation classes for class 9-10",
    batch_start: "2026-06-15",
    contact_phones: "+91 98765 43216",
    location: "Hyderabad",
  },
  vehicles: {
    make: "Maruti",
    model: "Swift",
    year: "2021",
    kilometers: "42000",
    fuel_type: "petrol",
    location: "Pune",
    contact_phones: "+91 98765 43217",
  },
};

const SAMPLE_BILLING_REFS: Record<ClassifiedType, string> = {
  matrimonial_with_photo: "INV-1001",
  matrimonial_no_photo: "INV-1002",
  job_vacancy: "INV-1003",
  job_wanted: "INV-1004",
  property_sale: "INV-1005",
  property_rent: "INV-1006",
  obituary: "INV-1007",
  public_notice: "INV-1008",
  announcement: "INV-1009",
  tender_notice: "INV-1010",
  education: "INV-1011",
  vehicles: "INV-1012",
};

/** Wrap a cell in quotes if it contains a comma, quote, or newline. */
function csvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Build the sample CSV: one header row containing the union of all
 * per-type columns, then one row per classified type with values for
 * that type's fields and empty cells for the rest.
 */
export function buildSampleClassifiedsCsv(): string {
  // Ordered union of all per-type field columns (preserves first
  // appearance — keeps related fields grouped roughly by type).
  const seen = new Set<string>();
  const fieldColumns: string[] = [];
  for (const type of Object.keys(COLUMNS_BY_TYPE) as ClassifiedType[]) {
    for (const col of COLUMNS_BY_TYPE[type]) {
      if (!seen.has(col)) {
        seen.add(col);
        fieldColumns.push(col);
      }
    }
  }

  const header = [...STANDARD_COLUMNS, ...fieldColumns].join(",");

  const rows = (Object.keys(COLUMNS_BY_TYPE) as ClassifiedType[]).map((type) => {
    const fields = SAMPLE_FIELDS[type];
    const cells: string[] = [
      type,
      "en",
      "1",
      SAMPLE_BILLING_REFS[type],
      ...fieldColumns.map((col) => csvCell(fields[col] ?? "")),
    ];
    return cells.join(",");
  });

  return `${header}\n${rows.join("\n")}\n`;
}

/** Pre-built sample CSV string. Cached at module load. */
export const SAMPLE_CLASSIFIEDS_CSV = buildSampleClassifiedsCsv();
