import { z } from "zod";

// Per CEO plan Section 6 + eng-plan §1 — language is a first-class tag.
// "bilingual" means mixed-script within a single article (not "two separate
// articles", which would be two separate records).
export const LanguageSchema = z.enum(["en", "hi", "bilingual"]);
export type Language = z.infer<typeof LanguageSchema>;

/**
 * Detect language of a body of text by counting Devanagari characters.
 *
 * Thresholds (tuned empirically, see tests):
 *   ratio >= 0.35 → hi         (Devanagari-dominant content)
 *   ratio >= 0.05 → bilingual  (mixed script — Hindi article with English brand
 *                               names OR English article with Hindi quotes)
 *   else          → en
 *
 * We count Devanagari CODEPOINTS in the 0x0900-0x097F block and compare against
 * total letters (Unicode `\p{L}`). Combining marks + conjunct forms are counted
 * because they ARE the script; pre-filtering them would under-weight Hindi.
 *
 * Layer 3 heuristic per eng-plan §1 — beats adding `franc`/`cld` for this case.
 */
const HI_THRESHOLD = 0.35;
const BILINGUAL_THRESHOLD = 0.05;

export function detectLanguage(text: string): Language {
  if (!text) return "en";
  let devanagari = 0;
  let letter = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code === undefined) continue;
    if (code >= 0x0900 && code <= 0x097f) {
      devanagari += 1;
      letter += 1;
    } else if (/\p{L}/u.test(ch)) {
      letter += 1;
    }
  }
  if (letter === 0) return "en";
  const ratio = devanagari / letter;
  if (ratio >= HI_THRESHOLD) return "hi";
  if (ratio >= BILINGUAL_THRESHOLD) return "bilingual";
  return "en";
}
