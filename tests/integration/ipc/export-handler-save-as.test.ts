import { describe, expect, test, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import type { Kysely } from "kysely";
import { createDb } from "../../../src/main/sqlite/db.js";
import type { Database } from "../../../src/main/sqlite/schema.js";
import {
  chooseExportPath,
  readAppSetting,
  resolveDefaultExportPath,
  revealInFinder,
  setRevealItemImpl,
  type SaveDialogResult,
  type ShowSaveDialog,
} from "../../../src/main/ipc/handlers/export.js";

// T17 — save-as dialog on PPTX export + last-dir memory + reveal-in-finder.
// Drives the dialog flow through the exported `chooseExportPath` helper so
// we don't need to spin up a BrowserWindow. The shell:reveal IPC handler
// reduces to `revealInFinder`, which we exercise via an injected spy.

let db: Kysely<Database>;

beforeEach(async () => {
  db = await createDb({ filename: ":memory:" });
});

afterEach(async () => {
  setRevealItemImpl(null);
  await db.destroy();
});

describe("chooseExportPath — cancel", () => {
  test("returns null when the operator dismisses the dialog", async () => {
    const calls: Parameters<ShowSaveDialog>[0][] = [];
    const stub: ShowSaveDialog = async (opts) => {
      calls.push(opts);
      return { canceled: true };
    };

    const result = await chooseExportPath(db, "weekly-2026-04-23.pptx", stub);
    expect(result).toBeNull();

    // Dialog was actually invoked with the expected options.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.title).toBe("Export to PowerPoint");
    expect(calls[0]?.filters).toEqual([{ name: "PowerPoint", extensions: ["pptx"] }]);
    expect(calls[0]?.defaultPath.endsWith("weekly-2026-04-23.pptx")).toBe(true);

    // Cancellation must NOT persist a last_export_dir (no setting yet).
    const stored = await readAppSetting(db, "last_export_dir");
    expect(stored).toBeNull();
  });

  test("treats a missing filePath the same as canceled", async () => {
    const stub: ShowSaveDialog = async () => ({ canceled: false } as SaveDialogResult);
    const result = await chooseExportPath(db, "x.pptx", stub);
    expect(result).toBeNull();
    expect(await readAppSetting(db, "last_export_dir")).toBeNull();
  });
});

describe("chooseExportPath — happy path", () => {
  test("returns the chosen path and persists last_export_dir", async () => {
    const chosen = path.join(os.tmpdir(), "operator-export-dir", "issue-42-2026-04-23.pptx");
    const stub: ShowSaveDialog = async () => ({ canceled: false, filePath: chosen });

    const result = await chooseExportPath(db, "issue-42-2026-04-23.pptx", stub);
    expect(result).toBe(chosen);

    const stored = await readAppSetting(db, "last_export_dir");
    expect(stored).toBe(path.dirname(chosen));
  });
});

describe("chooseExportPath — last-dir memory", () => {
  test("subsequent export defaults to the previously chosen directory", async () => {
    const firstChoice = path.join(os.tmpdir(), "forme-pick-1", "first.pptx");
    const seen: string[] = [];

    const firstStub: ShowSaveDialog = async (opts) => {
      seen.push(opts.defaultPath);
      return { canceled: false, filePath: firstChoice };
    };
    await chooseExportPath(db, "first.pptx", firstStub);

    // Verify the first call defaulted to ~/Downloads (no prior memory).
    expect(seen[0]?.startsWith(path.join(os.homedir(), "Downloads"))).toBe(true);

    // Second export — defaultPath should now point at the dir we just used.
    const secondStub: ShowSaveDialog = async (opts) => {
      seen.push(opts.defaultPath);
      return { canceled: true };
    };
    await chooseExportPath(db, "second.pptx", secondStub);

    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(path.join(path.dirname(firstChoice), "second.pptx"));
  });
});

describe("resolveDefaultExportPath", () => {
  test("falls back to ~/Downloads when no last_export_dir is set", async () => {
    const p = await resolveDefaultExportPath(db, "fresh.pptx");
    expect(p).toBe(path.join(os.homedir(), "Downloads", "fresh.pptx"));
  });
});

describe("shell:reveal — revealInFinder", () => {
  test("invokes shell.showItemInFolder with the supplied path", async () => {
    const calls: string[] = [];
    setRevealItemImpl((p) => {
      calls.push(p);
    });

    const target = "/tmp/forme/issue.pptx";
    const result = await revealInFinder({ path: target });

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([target]);
  });
});
