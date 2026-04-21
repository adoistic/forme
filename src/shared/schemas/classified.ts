import { z } from "zod";
import { LanguageSchema } from "./language.js";

// 12 classified types per CEO plan Section 14.1.
// Universal fields (billing_reference, weeks_to_run, language) per §14.2.
// Per-type field sets live under `fields`.

export const ClassifiedTypeSchema = z.enum([
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
]);
export type ClassifiedType = z.infer<typeof ClassifiedTypeSchema>;

// Loose phone validator — accepts India-shape (+91 98765 12345), US, etc.
// Strict: >= 7 digits after stripping non-digits.
const phoneOk = (s: string): boolean =>
  (s.match(/\d/g) ?? []).length >= 7 && (s.match(/\d/g) ?? []).length <= 20;
const PhoneSchema = z.string().refine(phoneOk, "Phone must have 7-20 digits");

// Universal fields per CEO §14.2
export const UniversalClassifiedFields = z.object({
  billing_reference: z.string().max(200).nullable().optional(),
  weeks_to_run: z.number().int().min(0).max(52).default(1),
  language: LanguageSchema.refine((l) => l !== "bilingual", {
    message: "classifieds must be strictly 'en' or 'hi', not bilingual",
  }),
});

// Per-type field sets (loose validation — we trust operator for tone).

const MatrimonialWithPhotoFields = z.object({
  name: z.string().min(1).max(120),
  age: z.number().int().min(18).max(100).optional(),
  height: z.string().max(40).optional(),
  religion_community: z.string().max(120).optional(),
  mother_tongue: z.string().max(60).optional(),
  education: z.string().max(200).optional(),
  occupation: z.string().max(200).optional(),
  income: z.string().max(60).optional(),
  location: z.string().max(120),
  marital_status: z.enum(["never_married", "divorced", "widowed"]).optional(),
  family_details: z.string().max(300).optional(),
  requirements: z.string().max(300).optional(),
  contact_name: z.string().max(120),
  contact_phones: z.array(PhoneSchema).min(1),
  contact_email: z.string().email().optional(),
  photo_blob_hash: z.string().length(64).optional(),
});

const MatrimonialNoPhotoFields = MatrimonialWithPhotoFields.omit({
  photo_blob_hash: true,
});

const JobVacancyFields = z.object({
  job_title: z.string().min(1).max(200),
  company_name: z.string().min(1).max(200),
  location: z.string().max(120),
  qualifications: z.string().max(500).optional(),
  experience_required: z.string().max(120).optional(),
  salary_range: z.string().max(120).optional(),
  contact_phones: z.array(PhoneSchema).min(1),
  contact_email: z.string().email().optional(),
  walk_in_datetime: z.string().optional(),
  application_deadline: z.string().optional(),
  how_to_apply: z.string().max(500).optional(),
});

const JobWantedFields = z.object({
  candidate_name: z.string().min(1).max(120),
  age: z.number().int().min(18).max(100).optional(),
  qualifications: z.string().max(500).optional(),
  experience: z.string().max(500).optional(),
  location_preferences: z.string().max(200).optional(),
  willing_to_relocate: z.boolean().optional(),
  contact_phones: z.array(PhoneSchema).min(1),
  pitch: z.string().max(300).optional(),
});

const PropertyBase = z.object({
  property_type: z.enum(["residential", "commercial", "plot", "agricultural"]),
  bedrooms: z.number().int().min(0).max(30).optional(),
  built_up_area_sqft: z.number().positive().optional(),
  plot_area_sqft: z.number().positive().optional(),
  location: z.string().min(1).max(200),
  key_features: z.string().max(300).optional(),
  contact_phones: z.array(PhoneSchema).min(1),
  photo_blob_hash: z.string().length(64).optional(),
});

const PropertySaleFields = PropertyBase.extend({
  expected_price: z.string().max(120).optional(),
});

const PropertyRentFields = PropertyBase.extend({
  monthly_rent: z.string().max(120).optional(),
  security_deposit: z.string().max(120).optional(),
  available_from: z.string().optional(),
  furnishing: z.enum(["furnished", "semi", "unfurnished"]).optional(),
  preferred_tenants: z.enum(["family", "bachelor", "company_lease", "any"]).optional(),
});

const ObituaryFields = z.object({
  name_of_deceased: z.string().min(1).max(200),
  photo_blob_hash: z.string().length(64).optional(),
  date_of_death: z.string(),
  age: z.number().int().min(0).max(125).optional(),
  life_summary: z.string().max(500).optional(),
  surviving_family: z.string().max(500).optional(),
  prayer_meeting: z.string().max(500).optional(),
  contact_for_condolences: z.string().max(300).optional(),
});

const PublicNoticeFields = z.object({
  notice_type: z.enum([
    "name_change",
    "lost_document",
    "missing_person",
    "legal_notice",
    "other",
  ]),
  notice_text: z.string().min(1).max(4000),
  published_by: z.string().min(1).max(200),
  date: z.string(),
});

const AnnouncementFields = z.object({
  occasion_type: z.enum([
    "birthday",
    "anniversary",
    "congratulations",
    "condolence",
    "festival",
    "other",
  ]),
  recipient_name: z.string().max(200).optional(),
  message_text: z.string().max(500),
  sender_names: z.array(z.string()).min(1),
  photo_blob_hash: z.string().length(64).optional(),
});

const TenderNoticeFields = z.object({
  tender_title: z.string().min(1).max(300),
  issuing_authority: z.string().min(1).max(200),
  tender_id: z.string().max(120).optional(),
  scope: z.string().max(500).optional(),
  eligibility: z.string().max(500).optional(),
  submission_deadline: z.string(),
  contact: z.string().max(300),
});

const EducationFields = z.object({
  institution_name: z.string().min(1).max(200),
  courses_offered: z.string().max(500),
  batch_start: z.string().optional(),
  contact_phones: z.array(PhoneSchema).min(1),
  location: z.string().max(200),
  logo_blob_hash: z.string().length(64).optional(),
});

const VehiclesFields = z.object({
  make: z.string().min(1).max(120),
  model: z.string().min(1).max(120),
  year: z.number().int().min(1920).max(2100),
  kilometers: z.number().int().nonnegative().optional(),
  fuel_type: z.enum(["petrol", "diesel", "cng", "electric", "hybrid", "other"]).optional(),
  expected_price: z.string().max(120).optional(),
  location: z.string().max(200),
  contact_phones: z.array(PhoneSchema).min(1),
  photo_blob_hash: z.string().length(64).optional(),
});

/** Map classified type → field schema. Exported so CSV import can validate
 *  per-type fields without a big switch statement. */
export const FieldSchemaByType = {
  matrimonial_with_photo: MatrimonialWithPhotoFields,
  matrimonial_no_photo: MatrimonialNoPhotoFields,
  job_vacancy: JobVacancyFields,
  job_wanted: JobWantedFields,
  property_sale: PropertySaleFields,
  property_rent: PropertyRentFields,
  obituary: ObituaryFields,
  public_notice: PublicNoticeFields,
  announcement: AnnouncementFields,
  tender_notice: TenderNoticeFields,
  education: EducationFields,
  vehicles: VehiclesFields,
} as const satisfies Record<ClassifiedType, z.ZodTypeAny>;

export type FieldsFor<T extends ClassifiedType> = z.infer<(typeof FieldSchemaByType)[T]>;

/** Full classified record (matches DB row plus parsed fields JSON). */
export const ClassifiedRecordSchema = z
  .object({
    id: z.string().uuid(),
    issue_id: z.string().uuid().nullable(),
    type: ClassifiedTypeSchema,
    language: LanguageSchema.refine((l) => l !== "bilingual"),
    weeks_to_run: z.number().int().min(0),
    photo_blob_hash: z.string().length(64).nullable(),
    fields: z.unknown(),
    billing_reference: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .superRefine((val, ctx) => {
    const fieldSchema = FieldSchemaByType[val.type];
    const result = fieldSchema.safeParse(val.fields);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          ...issue,
          path: ["fields", ...issue.path],
        });
      }
    }
  });

export type ClassifiedRecord = z.infer<typeof ClassifiedRecordSchema>;

/** Used by the CSV import preview — validate a single parsed row. */
export function validateClassified<T extends ClassifiedType>(
  type: T,
  fields: unknown
): { ok: true; data: FieldsFor<T> } | { ok: false; issues: z.core.$ZodIssue[] } {
  const result = FieldSchemaByType[type].safeParse(fields);
  if (result.success) {
    return { ok: true, data: result.data as FieldsFor<T> };
  }
  return { ok: false, issues: result.error.issues };
}
