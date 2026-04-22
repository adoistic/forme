// Print the actual line count pretext reports for a sample paragraph,
// and compare to a naive char-width estimate. Goal: figure out whether
// pretext is over-counting and by how much.

import { installCanvasShim } from "../src/main/pptx-prelayout/measure.js";

await installCanvasShim();
const pretext = await import("@chenglou/pretext");

const samples: { name: string; text: string }[] = [
  {
    name: "english-medium",
    text: "Iron tonics have an ancient history in ayurveda, but minerals and other metal substances began to enter the traditional pharmacopoeia more pervasively after the eleventh century, under the influence of early Indian alchemy or rasashastra.",
  },
  {
    name: "english-long",
    text: "Ayurveda (; IAST: ayurveda) is an alternative medicine system with historical roots in the Indian subcontinent. It is heavily practised throughout India and Nepal, where as much as 80% of the population report using ayurveda. The theory and practice of ayurveda are pseudoscientific, and many ayurvedic preparations, particularly in the rasa shastra tradition, contain toxic levels of lead, mercury, and arsenic. Ayurveda therapies have varied and evolved over more than two millennia.",
  },
  {
    name: "hindi",
    text: "कबीरदास या कबीर, कबीर साहेब 15वीं सदी के भारतीय रहस्यवादी कवि और संत थे। उनका जन्म 1398 में काशी में माना जाता है। कबीर अंधविश्वास, व्यक्ति पूजा, पाखंड और दोग के विरोधी थे। उन्होंने भारतीय समाज में जाति और धर्मों के बंधनों से गिरने का काम किया।",
  },
];

const colWidthIn = 2.0; // typical 3-col A4
const fontSizePt = 10;
const fontSizePx = (fontSizePt * 96) / 72; // 13.33
const colWidthPx = colWidthIn * 96; // 192

// Test multiple safety factors
for (const safety of [1.0, 0.96, 0.88]) {
  const measureColPx = colWidthPx * safety;
  console.log(`\n=== safety ${safety} (col ${measureColPx.toFixed(0)}px) ===`);
  for (const s of samples) {
    const fontFace = s.name.startsWith("hindi") ? "Mukta" : "Fraunces";
    const fontStr = `${fontSizePx}px ${JSON.stringify(fontFace)}`;
    const prepared = pretext.prepareWithSegments(s.text, fontStr);
    const stats = pretext.measureLineStats(prepared, measureColPx);
    const ratio = fontFace === "Mukta" ? 0.55 : 0.45;
    const fallbackChars = Math.floor(colWidthPx / (fontSizePx * ratio));
    const fallbackLines = Math.ceil(s.text.length / fallbackChars);
    console.log(
      `  ${s.name.padEnd(15)} ${s.text.length}ch  pretext=${stats.lineCount}L  fallback=${fallbackLines}L  font=${fontFace}`
    );
  }
}
