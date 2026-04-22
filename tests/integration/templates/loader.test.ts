import { describe, expect, test, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadTemplateFile, loadTemplatesFromDir } from "../../../src/main/templates/loader.js";

const repoRoot = process.cwd();
const templatesDir = path.join(repoRoot, "templates");
const standardFeatureA4 = path.join(templatesDir, "standard-feature-a4.json");

describe("loadTemplateFile", () => {
  test("parses the committed Standard Feature A4 template", async () => {
    const tpl = await loadTemplateFile(standardFeatureA4);
    expect(tpl.id).toBe("standard_feature_a4");
    expect(tpl.page_size).toBe("A4");
    expect(tpl.family).toBe("feature");
    expect(tpl.word_count_range.en).toEqual([900, 1800]);
    expect(tpl.geometry.columns).toBe(3);
  });

  test("throws template_incomplete on missing file", async () => {
    await expect(
      loadTemplateFile(path.join(templatesDir, "does-not-exist.json"))
    ).rejects.toMatchObject({ code: "template_incomplete" });
  });

  test("throws template_incomplete on invalid JSON", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "forme-tmpl-"));
    const badPath = path.join(tmp, "bad.json");
    try {
      await fs.writeFile(badPath, "{ not valid json");
      await expect(loadTemplateFile(badPath)).rejects.toMatchObject({
        code: "template_incomplete",
      });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test("throws template_incomplete on schema mismatch", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "forme-tmpl-"));
    const badPath = path.join(tmp, "wrong-shape.json");
    try {
      await fs.writeFile(
        badPath,
        JSON.stringify({ schemaVersion: 1, id: "x" }) // missing required fields
      );
      await expect(loadTemplateFile(badPath)).rejects.toMatchObject({
        code: "template_incomplete",
      });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("loadTemplatesFromDir", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "forme-tmpl-dir-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("loads every committed template from ./templates/", async () => {
    const templates = await loadTemplatesFromDir(templatesDir);
    expect(templates.length).toBeGreaterThanOrEqual(1);
    const ids = templates.map((t) => t.id);
    expect(ids).toContain("standard_feature_a4");
  });

  test("ignores non-JSON files", async () => {
    await fs.writeFile(path.join(tmpDir, "README.md"), "# docs");
    await fs.writeFile(path.join(tmpDir, ".DS_Store"), "");
    await fs.copyFile(standardFeatureA4, path.join(tmpDir, "t1.json"));
    const loaded = await loadTemplatesFromDir(tmpDir);
    expect(loaded).toHaveLength(1);
  });

  test("single bad template bubbles the error (no silent skip)", async () => {
    await fs.copyFile(standardFeatureA4, path.join(tmpDir, "good.json"));
    await fs.writeFile(path.join(tmpDir, "bad.json"), "{ not valid");
    await expect(loadTemplatesFromDir(tmpDir)).rejects.toMatchObject({
      code: "template_incomplete",
    });
  });
});
