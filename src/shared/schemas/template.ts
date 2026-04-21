import { z } from "zod";
import { LanguageSchema } from "./language.js";
import { ContentTypeSchema } from "./article.js";

// Per CEO plan Section 9.2 + eng-plan §3.
// Template JSON is the data contract that links template files ↔ auto-fit ↔ renderer.
// Schema version is locked from day 1 per CEO 10A to support future migrations.

export const PageSizeSchema = z.enum(["A4", "A5"]);
export type PageSize = z.infer<typeof PageSizeSchema>;

export const ImageAspectPreferenceSchema = z.enum([
  "portrait",
  "landscape",
  "square",
  "any",
]);
export type ImageAspectPreference = z.infer<typeof ImageAspectPreferenceSchema>;

/** Word count range per language. */
export const WordCountRangeSchema = z.object({
  en: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  hi: z.tuple([z.number().int().positive(), z.number().int().positive()]),
});

export const TemplateSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    family: z.enum([
      "feature",
      "photo_essay",
      "interview",
      "short_editorial",
      "opinion",
      "poetry",
      "service",
    ]),
    page_size: PageSizeSchema,
    page_count_range: z.tuple([
      z.number().int().positive(),
      z.number().int().positive(),
    ]),
    word_count_range: WordCountRangeSchema,
    required_images: z.number().int().nonnegative(),
    optional_images: z.tuple([
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
    ]),
    image_aspect_preferences: z.array(ImageAspectPreferenceSchema),
    supports_pull_quote: z.boolean(),
    supports_sidebar: z.boolean(),
    language_modes: z.array(LanguageSchema).min(1),
    content_type: ContentTypeSchema,
    typography_pairing_default: z.string().min(1),
    exposed_settings: z.array(z.string()),
    // typography knobs the renderer consumes (body/headline/caption sizes in pt)
    typography: z.object({
      body_pt: z.number().positive(),
      body_leading_pt: z.number().positive(),
      headline_pt: z.number().positive(),
      caption_pt: z.number().positive().optional(),
      deck_pt: z.number().positive().optional(),
    }),
    // page geometry in mm (matches DESIGN.md §11 + CEO §4.2)
    geometry: z.object({
      trim_mm: z.tuple([z.number().positive(), z.number().positive()]),
      bleed_mm: z.number().nonnegative().default(3),
      safe_mm: z.number().nonnegative().default(5),
      columns: z.number().int().positive(),
      gutter_mm: z.number().nonnegative(),
      margins_mm: z.object({
        top: z.number().nonnegative(),
        right: z.number().nonnegative(),
        bottom: z.number().nonnegative(),
        left: z.number().nonnegative(),
      }),
    }),
  })
  .refine((t) => t.word_count_range.en[0] <= t.word_count_range.en[1], {
    message: "word_count_range.en must be [min, max] with min <= max",
    path: ["word_count_range", "en"],
  })
  .refine((t) => t.word_count_range.hi[0] <= t.word_count_range.hi[1], {
    message: "word_count_range.hi must be [min, max] with min <= max",
    path: ["word_count_range", "hi"],
  })
  .refine((t) => t.page_count_range[0] <= t.page_count_range[1], {
    message: "page_count_range must be [min, max] with min <= max",
    path: ["page_count_range"],
  })
  .refine((t) => t.optional_images[0] <= t.optional_images[1], {
    message: "optional_images must be [min, max] with min <= max",
    path: ["optional_images"],
  });

export type Template = z.infer<typeof TemplateSchema>;
