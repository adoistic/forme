import fs from "node:fs/promises";
import path from "node:path";
import { TemplateSchema, type Template } from "@shared/schemas/template.js";
import { makeError } from "@shared/errors/structured.js";

// Template loader per docs/eng-plan.md §3 ("Templates must be data, not code").
// JSON files under templates/ are the single source of truth. On load, we
// validate with Zod and fail loudly on schema mismatch so bad template JSON
// never reaches the renderer.

/**
 * Load and validate a single template JSON file by absolute path.
 */
export async function loadTemplateFile(absolutePath: string): Promise<Template> {
  let raw: string;
  try {
    raw = await fs.readFile(absolutePath, "utf8");
  } catch (cause: unknown) {
    throw makeError("template_incomplete", "error", {
      path: absolutePath,
      reason: cause instanceof Error ? cause.message : "read failed",
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause: unknown) {
    throw makeError("template_incomplete", "error", {
      path: absolutePath,
      reason: cause instanceof Error ? cause.message : "invalid JSON",
    });
  }

  const result = TemplateSchema.safeParse(parsed);
  if (!result.success) {
    throw makeError("template_incomplete", "error", {
      path: absolutePath,
      issues: result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    });
  }

  return result.data;
}

/**
 * Load all templates in a directory. Files ending in .json are parsed; anything
 * else (README, .DS_Store, etc.) is ignored.
 */
export async function loadTemplatesFromDir(dir: string): Promise<Template[]> {
  const files = await fs.readdir(dir);
  const jsonFiles = files.filter((f) => f.endsWith(".json") && !f.startsWith("."));
  const templates: Template[] = [];
  for (const f of jsonFiles) {
    const tpl = await loadTemplateFile(path.join(dir, f));
    templates.push(tpl);
  }
  return templates;
}
