import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import type { FontBundle } from "./fonts.js";

// Post-process a pptx to embed TTF font data so the file renders
// identically on machines that don't have the fonts installed.
//
// Why post-process?
//   pptxgenjs doesn't have a native font-embedding API. PPTX embedding
//   itself is defined in ECMA-376 §13.2 — under `<p:embeddedFontLst>` —
//   but pptxgenjs only writes font *references* (the `fontFace` option).
//   So we open the pptx zip after writeFile and add:
//     1. /ppt/fonts/fontN.fntdata       (raw TTF bytes)
//     2. Override in [Content_Types].xml
//     3. Relationship in /ppt/_rels/presentation.xml.rels
//     4. <p:embeddedFontLst> entry inside <p:presentation>
//
// PowerPoint strictly wants obfuscated fonts (first 32 bytes XOR'd with
// a GUID-derived mask); LibreOffice accepts both. We obfuscate for
// maximum compatibility per the spec.

const FONT_RELATIONSHIP_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/font";
const OBFUSCATED_FONT_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.obfuscatedFont";
const RELATIONSHIPS_NS =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const CONTENT_TYPES_NS =
  "http://schemas.openxmlformats.org/package/2006/content-types";

/**
 * Group bundled font files by logical typeface name ("Fraunces", "Inter",
 * "Mukta"). pptxgenjs writes the typeface name into each text run; we emit
 * one <p:embeddedFont> per unique name with sub-entries per face (regular,
 * bold, italic, bold-italic).
 */
function groupByName(bundles: FontBundle[]): Map<string, FontBundle[]> {
  const byName = new Map<string, FontBundle[]>();
  for (const b of bundles) {
    const arr = byName.get(b.fontName) ?? [];
    arr.push(b);
    byName.set(b.fontName, arr);
  }
  return byName;
}

/**
 * Obfuscate the first 32 bytes of TTF data per ECMA-376 Part 2 §10.1.2.8.
 * The mask is derived from the GUID that will go into the relationship's
 * Id attribute: GUID hex bytes in the specific reversed structure order.
 * We XOR two passes of 16 bytes each.
 */
function obfuscateTtf(ttfBytes: Buffer, guid: string): Buffer {
  // GUID format: "{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}". Strip + split.
  const cleaned = guid.replace(/[{}-]/g, "");
  if (cleaned.length !== 32) {
    throw new Error(`bad GUID for obfuscation: ${guid}`);
  }
  // ECMA-376 spec: GUID bytes reordered as follows for the 16-byte mask:
  //   bytes 0-3  → little-endian (reverse)
  //   bytes 4-5  → little-endian (reverse)
  //   bytes 6-7  → little-endian (reverse)
  //   bytes 8-15 → big-endian (as-is)
  const bytes = Buffer.from(cleaned, "hex");
  const mask = Buffer.alloc(16);
  mask[0] = bytes[3]!;
  mask[1] = bytes[2]!;
  mask[2] = bytes[1]!;
  mask[3] = bytes[0]!;
  mask[4] = bytes[5]!;
  mask[5] = bytes[4]!;
  mask[6] = bytes[7]!;
  mask[7] = bytes[6]!;
  for (let i = 8; i < 16; i += 1) mask[i] = bytes[i]!;

  const out = Buffer.from(ttfBytes);
  // Two 16-byte passes over the first 32 bytes
  for (let i = 0; i < 32 && i < out.length; i += 1) {
    out[i] = out[i]! ^ mask[i % 16]!;
  }
  return out;
}

/**
 * Generate a deterministic-but-legal GUID for each embedded font. Using a
 * counter keeps the output byte-stable across runs (nice for diffs).
 */
function makeGuid(counter: number): string {
  const hex = counter.toString(16).padStart(12, "0");
  return `{00000000-0000-0000-0000-${hex}}`;
}

interface EmbedPlan {
  fileName: string; // "font1.fntdata"
  relId: string; // "rIdFont1"
  guid: string; // "{0000-...}"
  typeface: string; // "Fraunces"
  face: FontBundle["fontFace"]; // "normal" / "bold" / etc
  bytes: Buffer; // raw TTF (not yet obfuscated)
}

/**
 * Read zip, insert font streams + relationship + content-type + embedded
 * font list, write zip back to disk. Mutates the .pptx in place.
 */
export async function embedFontsIntoPptx(
  pptxPath: string,
  bundles: FontBundle[]
): Promise<void> {
  if (bundles.length === 0) return;

  const original = await fs.readFile(pptxPath);
  const zip = await JSZip.loadAsync(original);

  const contentTypesXml = await zip.file("[Content_Types].xml")?.async("string");
  const relsXml = await zip
    .file("ppt/_rels/presentation.xml.rels")
    ?.async("string");
  const presXml = await zip.file("ppt/presentation.xml")?.async("string");

  if (!contentTypesXml || !relsXml || !presXml) {
    throw new Error("pptx is missing expected parts — aborting font embed");
  }

  // Build per-font plans
  const plans: EmbedPlan[] = [];
  let counter = 1;
  for (const b of bundles) {
    const ttfBytes = await fs.readFile(b.path);
    plans.push({
      fileName: `font${counter}.fntdata`,
      relId: `rIdFormeFont${counter}`,
      guid: makeGuid(counter),
      typeface: b.fontName,
      face: b.fontFace,
      bytes: ttfBytes,
    });
    counter += 1;
  }

  // 1) Drop obfuscated font streams into ppt/fonts/
  for (const p of plans) {
    const obf = obfuscateTtf(p.bytes, p.guid);
    zip.file(`ppt/fonts/${p.fileName}`, obf);
  }

  // 2) Patch [Content_Types].xml — add a Default for fntdata OR Overrides
  //    per part. The Default approach is cleanest.
  let newContentTypes = contentTypesXml;
  if (!newContentTypes.includes('Extension="fntdata"')) {
    newContentTypes = newContentTypes.replace(
      /<Types[^>]*>/,
      (match) =>
        `${match}<Default Extension="fntdata" ContentType="${OBFUSCATED_FONT_CONTENT_TYPE}"/>`
    );
  }
  zip.file("[Content_Types].xml", newContentTypes);

  // 3) Patch ppt/_rels/presentation.xml.rels — append one Relationship per font
  const newRelsXml = relsXml.replace(
    /<\/Relationships>\s*$/,
    () => {
      const items = plans
        .map(
          (p) =>
            `<Relationship Id="${p.relId}" Type="${FONT_RELATIONSHIP_TYPE}" Target="fonts/${p.fileName}"/>`
        )
        .join("");
      return `${items}</Relationships>`;
    }
  );
  zip.file("ppt/_rels/presentation.xml.rels", newRelsXml);

  // 4) Patch ppt/presentation.xml — inject <p:embeddedFontLst> just before
  //    </p:presentation>. Group by typeface so each <p:embeddedFont> has
  //    multiple face entries (regular, bold, italic, bold-italic).
  const groups = groupByName(bundles);
  const facesByTypeface = new Map<string, Map<FontBundle["fontFace"], EmbedPlan>>();
  for (const p of plans) {
    const inner = facesByTypeface.get(p.typeface) ?? new Map();
    inner.set(p.face, p);
    facesByTypeface.set(p.typeface, inner);
  }

  const embeddedFontLst = [...groups.keys()]
    .map((typeface) => {
      const faces = facesByTypeface.get(typeface) ?? new Map();
      const faceEntries = [
        ["regular", faces.get("normal")] as const,
        ["bold", faces.get("bold")] as const,
        ["italic", faces.get("italic")] as const,
        ["boldItalic", faces.get("bold-italic")] as const,
      ]
        .filter(([, p]) => Boolean(p))
        .map(([tag, p]) => `<p:${tag} r:id="${p!.relId}"/>`)
        .join("");
      return (
        `<p:embeddedFont>` +
        `<p:font typeface="${typeface}"/>` +
        faceEntries +
        `</p:embeddedFont>`
      );
    })
    .join("");

  const embeddedFontSection = `<p:embeddedFontLst>${embeddedFontLst}</p:embeddedFontLst>`;

  let newPresXml = presXml;
  if (!newPresXml.includes("<p:embeddedFontLst")) {
    // Inject just before </p:presentation>. ECMA-376 specifies
    // embeddedFontLst after sldIdLst + sldSz + notesSz — matching PowerPoint.
    newPresXml = newPresXml.replace(
      /<\/p:presentation>\s*$/,
      `${embeddedFontSection}</p:presentation>`
    );
  }
  zip.file("ppt/presentation.xml", newPresXml);

  // Write zip back, same compression as pptxgenjs
  const out = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  await fs.writeFile(pptxPath, out);
}
