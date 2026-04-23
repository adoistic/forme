import React, { useState } from "react";
import { invoke } from "../../ipc/client.js";
import { useToast } from "../../components/Toast.js";
import { describeError } from "../../lib/error-helpers.js";
import {
  parseClassifiedsJson,
  type JsonImportResult,
} from "../../csv-import/parse-json.js";

// JSON import modal (T16). Two intake paths share one parser:
//   - file picker (.json) — content is read into the textarea so the
//     operator can review before submitting
//   - paste-into-textarea — for pasting from a script's stdout
// Validation runs on every change so per-row errors show inline; clicking
// Import calls classified:add for each valid row sequentially.

interface Props {
  issueId: string | null;
  onClose: () => void;
  onImported: (count: number) => Promise<void> | void;
}

export function JsonImportModal({ issueId, onClose, onImported }: Props): React.ReactElement {
  const toast = useToast();
  const [jsonText, setJsonText] = useState<string>("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<JsonImportResult | null>(null);
  const [importing, setImporting] = useState(false);

  function reparse(text: string): void {
    setJsonText(text);
    if (text.trim().length === 0) {
      setParseError(null);
      setResult(null);
      return;
    }
    try {
      const r = parseClassifiedsJson({ json: text });
      setResult(r);
      setParseError(null);
    } catch (e) {
      // Top-level parse / shape / size errors — entire payload is unusable.
      const ctx = (e as { context?: { reason?: string; rows?: number; max?: number } }).context;
      const reason =
        ctx?.reason ??
        (ctx?.rows !== undefined
          ? `too many rows (${ctx.rows} > ${ctx.max})`
          : "JSON parse failed");
      setParseError(reason);
      setResult(null);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const text = await file.text();
    reparse(text);
  }

  async function handleImport(): Promise<void> {
    if (!result || result.validRows === 0) return;
    setImporting(true);
    let added = 0;
    let failed = 0;
    try {
      for (const row of result.rows) {
        if (!row.valid || !row.parsed) continue;
        try {
          await invoke("classified:add", {
            issueId,
            type: row.parsed.type,
            language: row.parsed.language,
            weeksToRun: row.parsed.weeksToRun,
            billingReference: row.parsed.billingReference,
            fields: row.parsed.fields,
          });
          added += 1;
        } catch (err) {
          failed += 1;
          // Log per-row failure but keep importing the rest.
          toast.push("error", `Row ${row.rowNumber}: ${describeError(err)}`);
        }
      }
      await onImported(added);
      if (failed > 0) {
        toast.push(
          "info",
          `${added} imported, ${failed} failed mid-import. See errors above.`
        );
      }
    } finally {
      setImporting(false);
    }
  }

  return (
    <div
      className="bg-bg-overlay fixed inset-0 z-40 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-bg-surface max-h-[90vh] w-[720px] overflow-y-auto rounded-xl p-8 shadow-lg"
        data-testid="json-import-modal"
      >
        <div className="mb-2 flex items-start justify-between">
          <div>
            <div className="text-label-caps text-accent mb-1">IMPORT FROM JSON</div>
            <h2 className="font-display text-display-md text-text-primary">
              Paste or pick a .json file.
            </h2>
            <p className="text-caption text-text-secondary mt-1">
              Format: an array of{" "}
              <code className="text-caption text-text-primary">{`{ type, language, weeksToRun, fields }`}</code>{" "}
              entries.
            </p>
          </div>
          <label
            className="border-accent text-title-sm text-accent hover:bg-accent-bg cursor-pointer rounded-md border-[1.5px] px-3 py-1.5"
            data-testid="json-import-file-button"
          >
            Pick .json file
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleFile}
              data-testid="json-import-file-input"
            />
          </label>
        </div>

        <textarea
          value={jsonText}
          onChange={(e) => reparse(e.target.value)}
          rows={12}
          spellCheck={false}
          placeholder={
            '[\n  {\n    "type": "matrimonial_with_photo",\n    "language": "en",\n    "weeksToRun": 2,\n    "fields": { "name": "Aanya", "age": 28, "location": "Mumbai", "contact_name": "Priya", "contact_phones": ["+91 98765 43210"] }\n  }\n]'
          }
          className="border-border-default bg-bg-surface text-caption text-text-primary focus:border-accent mt-4 w-full rounded-md border-[1.5px] px-3 py-2 font-mono focus:outline-none"
          data-testid="json-import-textarea"
        />

        {parseError ? (
          <div
            className="border-error bg-error/10 text-body text-error mt-3 rounded-md border px-4 py-3"
            data-testid="json-import-parse-error"
          >
            <div className="text-label-caps text-error mb-1">JSON parse error</div>
            <div className="break-words">{parseError}</div>
          </div>
        ) : null}

        {result ? (
          <div className="mt-4">
            <div className="text-caption text-text-secondary mb-2">
              {result.totalRows} row{result.totalRows === 1 ? "" : "s"} ·{" "}
              <span className="text-success">{result.validRows} valid</span>
              {result.invalidRows > 0 ? (
                <>
                  {" "}
                  ·{" "}
                  <span className="text-error" data-testid="json-import-invalid-count">
                    {result.invalidRows} invalid
                  </span>
                </>
              ) : null}
            </div>
            {result.invalidRows > 0 ? (
              <ul
                className="border-border-default bg-bg-canvas text-caption text-text-primary mb-2 max-h-[200px] divide-y divide-border-default overflow-y-auto rounded-md border"
                data-testid="json-import-error-list"
              >
                {result.rows
                  .filter((r) => !r.valid)
                  .map((r) => (
                    <li key={r.rowNumber} className="px-3 py-2">
                      <span className="text-text-secondary">Row {r.rowNumber}:</span>{" "}
                      {r.issues
                        .map((i) => `${i.field} — ${i.message}`)
                        .join("; ")}
                    </li>
                  ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="text-title-sm text-text-secondary rounded-md px-4 py-2 hover:bg-black/[0.04]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={importing || !result || result.validRows === 0}
            className="bg-accent text-title-sm text-text-inverse hover:bg-accent-hover rounded-md px-5 py-2 font-semibold disabled:opacity-40"
            data-testid="json-import-submit"
          >
            {importing
              ? "Importing..."
              : result
                ? `Import ${result.validRows} valid row${result.validRows === 1 ? "" : "s"}`
                : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
