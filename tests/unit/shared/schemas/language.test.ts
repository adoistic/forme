import { describe, expect, test } from "vitest";
import { detectLanguage } from "../../../../src/shared/schemas/language.js";

describe("detectLanguage", () => {
  test("pure English body → en", () => {
    const text = "The quick brown fox jumps over the lazy dog. A long article about print.";
    expect(detectLanguage(text)).toBe("en");
  });

  test("pure Devanagari body → hi", () => {
    const text = "यह पूरी तरह से देवनागरी में लिखा गया एक पाठ है जिसमें कोई भी अंग्रेज़ी अक्षर नहीं है";
    expect(detectLanguage(text)).toBe("hi");
  });

  test("mixed-script with Devanagari-majority → hi", () => {
    // ~48% Devanagari — dominant
    const text =
      "मोदी ने दिल्ली का दौरा किया और प्रेस से बात की then spoke briefly";
    expect(detectLanguage(text)).toBe("hi");
  });

  test("mixed-script with ~8% Devanagari → bilingual", () => {
    // Devanagari minority but present — crosses the 5% threshold, below 35%
    const text =
      "Some English words with a few Hindi words मेरा नाम is Raj and more English content here in this sentence to pad it out with plenty of additional Latin letters";
    expect(detectLanguage(text)).toBe("bilingual");
  });

  test("empty string → en", () => {
    expect(detectLanguage("")).toBe("en");
  });

  test("whitespace-only → en", () => {
    expect(detectLanguage("    \n\t  ")).toBe("en");
  });

  test("punctuation + digits only → en", () => {
    expect(detectLanguage("123 456 !@#$%^&*()")).toBe("en");
  });

  test("single Devanagari word in long English → en (< 10% threshold)", () => {
    const text = "This is a very long English article about many topics and things and";
    const padding = new Array(20)
      .fill("more English words that come after each other in this sentence")
      .join(" ");
    expect(detectLanguage(text + " " + padding)).toBe("en");
  });

  test("English brand name in Hindi body → hi (brand is minority)", () => {
    const text =
      "रिज़र्व बैंक ऑफ़ इंडिया ने आज एक नई नीति जारी की जिसमें कई बदलाव किए गए हैं। यह नीति RBI आधिकारिक तौर पर लागू हो चुकी है";
    expect(detectLanguage(text)).toBe("hi");
  });
});
