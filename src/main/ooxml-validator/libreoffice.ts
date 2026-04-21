import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { makeError, type StructuredError } from "@shared/errors/structured.js";
import { createLogger } from "../logger.js";

const execFileAsync = promisify(execFile);
const logger = createLogger("ooxml-validator");

// LibreOffice headless round-trip validator per docs/eng-plan.md §1 (OOXML
// validation) + CEO decision 2A. Only runs on "Check my issue" + Phase 1
// harness, NOT on every export.
//
// If LibreOffice successfully converts the .pptx to PDF without error, we
// treat the PPTX as syntactically valid. This is a pragmatic proxy: real
// OOXML schema validation is hard in JS, and LibreOffice's parser is strict
// enough to catch the vast majority of issues pptxgenjs could produce.

export interface ValidateResult {
  valid: boolean;
  stdout: string;
  stderr: string;
  /** PDF path produced by LibreOffice; caller can reuse this for preview. */
  pdfPath: string | null;
  durationMs: number;
}

export interface ValidateOptions {
  /** Full path to the .pptx file on disk. */
  pptxPath: string;
  /** Optional custom timeout in ms. Default 60s. */
  timeoutMs?: number;
  /** Soffice binary path override; auto-detected otherwise. */
  sofficeBinary?: string;
}

/**
 * Runs `soffice --headless --convert-to pdf --outdir TMP PPTX_PATH`.
 * Resolves `valid:true` on success, throws StructuredError on failure.
 */
export async function validatePptx(options: ValidateOptions): Promise<ValidateResult> {
  const { pptxPath, timeoutMs = 60_000 } = options;
  const sofficeBinary = options.sofficeBinary ?? (await findSoffice());

  if (!sofficeBinary) {
    throw makeError("libreoffice_not_installed", "error", {
      path: pptxPath,
    });
  }

  try {
    await fs.access(pptxPath);
  } catch {
    throw makeError("ooxml_validation_error", "error", {
      path: pptxPath,
      reason: "file not found",
    });
  }

  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "forme-ooxml-"));
  const start = Date.now();

  try {
    // Use a unique UserInstallation dir per invocation so parallel soffice
    // calls don't block on each other's profile lock. Without this, a second
    // soffice call while the first is still running silently exits 0 without
    // producing output.
    const userProfile = await fs.mkdtemp(path.join(os.tmpdir(), "forme-soffice-profile-"));
    const { stdout, stderr } = await execFileAsync(
      sofficeBinary,
      [
        `-env:UserInstallation=file://${userProfile}`,
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        outDir,
        pptxPath,
      ],
      { timeout: timeoutMs }
    );

    const base = path.basename(pptxPath, ".pptx");
    const pdfPath = path.join(outDir, `${base}.pdf`);

    // Soffice sometimes exits 0 but produces no file on parse failure
    const pdfExists = await fileExists(pdfPath);
    if (!pdfExists) {
      throw makeError("ooxml_validation_error", "error", {
        path: pptxPath,
        reason: "soffice produced no PDF",
        stderr: stderr.trim() || stdout.trim(),
      });
    }

    return {
      valid: true,
      stdout,
      stderr,
      pdfPath,
      durationMs: Date.now() - start,
    };
  } catch (thrown: unknown) {
    if (isStructuredError(thrown)) throw thrown;

    const msg = thrown instanceof Error ? thrown.message : String(thrown);
    if (/timed out|ETIMEDOUT/i.test(msg)) {
      throw makeError("libreoffice_timeout", "error", {
        path: pptxPath,
        timeoutMs,
      });
    }
    logger.warn({ msg, pptxPath }, "LibreOffice validation threw");
    throw makeError("ooxml_validation_error", "error", {
      path: pptxPath,
      reason: msg,
    });
  }
}

/**
 * Locate soffice on disk. Checks Homebrew default, /Applications, then PATH.
 */
export async function findSoffice(): Promise<string | null> {
  const candidates = [
    "/opt/homebrew/bin/soffice",
    "/usr/local/bin/soffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  ];
  for (const c of candidates) {
    if (await fileExists(c)) return c;
  }
  // Try PATH
  try {
    const { stdout } = await execFileAsync("which", ["soffice"]);
    const trimmed = stdout.trim();
    if (trimmed && (await fileExists(trimmed))) return trimmed;
  } catch {
    // not on PATH
  }
  return null;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function isStructuredError(value: unknown): value is StructuredError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "severity" in value
  );
}
