import React, { useState } from "react";
import { invoke } from "../../ipc/client.js";
import { useToast } from "../../components/Toast.js";
import { describeError } from "../../lib/error-helpers.js";
import type { ClassifiedType } from "@shared/schemas/classified.js";

// Minimal per-type forms. Phase 2 covers the 5 most common types with hand-rolled
// UIs; less-common types fall back to a generic textarea that accepts JSON so
// data is still capturable. Phases 9-10 replace this with full bespoke forms.

interface Props {
  type: ClassifiedType;
  typeLabel: string;
  issueId: string | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export function AddClassifiedModal(props: Props): React.ReactElement {
  const toast = useToast();
  const [language, setLanguage] = useState<"en" | "hi">("en");
  const [weeksToRun, setWeeksToRun] = useState<number>(1);
  const [billing, setBilling] = useState("");
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState<string>("{}");

  function setField(name: string, value: unknown): void {
    setFields((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    try {
      const payloadFields = jsonMode ? JSON.parse(jsonText) : normalizeFields(fields);
      await invoke("classified:add", {
        issueId: props.issueId,
        type: props.type,
        language,
        weeksToRun,
        billingReference: billing.trim() || null,
        fields: payloadFields,
      });
      await props.onSaved();
    } catch (e) {
      toast.push("error", describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-bg-overlay"
      onClick={props.onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-[620px] overflow-y-auto rounded-xl bg-bg-surface p-8 shadow-lg"
        data-testid="add-classified-modal"
      >
        <div className="mb-1 flex items-start justify-between">
          <div>
            <div className="mb-1 text-label-caps text-accent">NEW CLASSIFIED</div>
            <h2 className="font-display text-display-md text-text-primary">{props.typeLabel}</h2>
          </div>
          <button
            type="button"
            onClick={() => setJsonMode((v) => !v)}
            className="text-caption text-text-tertiary underline"
          >
            {jsonMode ? "form view" : "JSON view"}
          </button>
        </div>

        {/* Language + weeks row */}
        <div className="mb-4 mt-6 grid grid-cols-2 gap-4">
          <div>
            <span className="mb-1 block text-label-caps text-text-secondary">Content language</span>
            <div className="flex gap-1">
              {(["en", "hi"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLanguage(l)}
                  className={[
                    "flex-1 rounded-full px-3 py-1.5 text-title-sm transition-colors",
                    language === l
                      ? "bg-accent text-text-inverse"
                      : "text-text-secondary hover:bg-black/[0.04]",
                  ].join(" ")}
                >
                  {l === "en" ? "English" : "Hindi"}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-label-caps text-text-secondary">Weeks to run</span>
            <input
              type="number"
              min={1}
              max={52}
              value={weeksToRun}
              onChange={(e) => setWeeksToRun(Math.max(0, Math.min(52, Number(e.target.value))))}
              className="w-full rounded-md border-[1.5px] border-border-default bg-bg-surface px-3 py-2.5 text-body focus:border-accent focus:outline-none"
            />
          </label>
        </div>

        {/* Type-specific fields */}
        {jsonMode ? (
          <JsonModeEditor value={jsonText} onChange={setJsonText} />
        ) : (
          <TypeSpecificForm type={props.type} fields={fields} setField={setField} />
        )}

        {/* Billing ref (internal only) */}
        <label className="mt-4 block">
          <span className="mb-1 block text-label-caps text-text-secondary">
            Billing reference <span className="ml-1 italic text-text-tertiary">internal · never printed</span>
          </span>
          <input
            type="text"
            value={billing}
            onChange={(e) => setBilling(e.target.value)}
            placeholder="INV-0001"
            className="w-full rounded-md border-[1.5px] border-border-default bg-bg-surface px-3 py-2.5 text-body focus:border-accent focus:outline-none"
          />
        </label>

        {/* Actions */}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-md px-4 py-2 text-title-sm text-text-secondary hover:bg-black/[0.04]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-accent px-5 py-2 text-title-sm font-semibold text-text-inverse hover:bg-accent-hover disabled:opacity-40"
            data-testid="classified-submit"
          >
            {busy ? "Saving..." : "Save to queue"}
          </button>
        </div>
      </form>
    </div>
  );
}

function TypeSpecificForm({
  type,
  fields,
  setField,
}: {
  type: ClassifiedType;
  fields: Record<string, unknown>;
  setField: (name: string, value: unknown) => void;
}): React.ReactElement {
  const val = (name: string): string => (fields[name] as string | undefined) ?? "";

  const text = (name: string, label: string, required = false): React.ReactElement => (
    <label className="block">
      <span className="mb-1 block text-label-caps text-text-secondary">
        {label} {required ? <span className="text-accent">*</span> : null}
      </span>
      <input
        type="text"
        value={val(name)}
        onChange={(e) => setField(name, e.target.value)}
        required={required}
        className="w-full rounded-md border-[1.5px] border-border-default bg-bg-surface px-3 py-2 text-body focus:border-accent focus:outline-none"
      />
    </label>
  );

  const number = (name: string, label: string, required = false): React.ReactElement => (
    <label className="block">
      <span className="mb-1 block text-label-caps text-text-secondary">
        {label} {required ? <span className="text-accent">*</span> : null}
      </span>
      <input
        type="number"
        value={(fields[name] as number | undefined) ?? ""}
        onChange={(e) => setField(name, e.target.value ? Number(e.target.value) : undefined)}
        required={required}
        className="w-full rounded-md border-[1.5px] border-border-default bg-bg-surface px-3 py-2 text-body focus:border-accent focus:outline-none"
      />
    </label>
  );

  const textarea = (name: string, label: string, required = false): React.ReactElement => (
    <label className="block">
      <span className="mb-1 block text-label-caps text-text-secondary">
        {label} {required ? <span className="text-accent">*</span> : null}
      </span>
      <textarea
        value={val(name)}
        onChange={(e) => setField(name, e.target.value)}
        required={required}
        rows={4}
        className="w-full rounded-md border-[1.5px] border-border-default bg-bg-surface px-3 py-2 text-body focus:border-accent focus:outline-none"
      />
    </label>
  );

  switch (type) {
    case "matrimonial_with_photo":
    case "matrimonial_no_photo":
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {text("name", "Name", true)}
            {number("age", "Age")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {text("location", "Location / city", true)}
            {text("religion_community", "Religion / community")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {text("education", "Education")}
            {text("occupation", "Occupation")}
          </div>
          {text("contact_name", "Contact name", true)}
          {text("contact_phones", "Contact phones (comma separated)", true)}
        </div>
      );
    case "obituary":
      return (
        <div className="space-y-3">
          {text("name_of_deceased", "Name of deceased", true)}
          <div className="grid grid-cols-2 gap-3">
            {text("date_of_death", "Date of death (YYYY-MM-DD)", true)}
            {number("age", "Age")}
          </div>
          {textarea("life_summary", "Life summary")}
          {textarea("surviving_family", "Surviving family")}
          {textarea("prayer_meeting", "Prayer meeting / venue")}
        </div>
      );
    case "public_notice":
      return (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-label-caps text-text-secondary">
              Notice type <span className="text-accent">*</span>
            </span>
            <select
              value={val("notice_type") || "other"}
              onChange={(e) => setField("notice_type", e.target.value)}
              className="w-full rounded-md border-[1.5px] border-border-default bg-bg-surface px-3 py-2 text-body focus:border-accent focus:outline-none"
            >
              <option value="name_change">Name change</option>
              <option value="lost_document">Lost document</option>
              <option value="missing_person">Missing person</option>
              <option value="legal_notice">Legal notice</option>
              <option value="other">Other</option>
            </select>
          </label>
          {textarea("notice_text", "Notice text", true)}
          {text("published_by", "Published by", true)}
          {text("date", "Date (YYYY-MM-DD)", true)}
        </div>
      );
    case "announcement":
      return (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-label-caps text-text-secondary">Occasion</span>
            <select
              value={val("occasion_type") || "birthday"}
              onChange={(e) => setField("occasion_type", e.target.value)}
              className="w-full rounded-md border-[1.5px] border-border-default bg-bg-surface px-3 py-2 text-body focus:border-accent focus:outline-none"
            >
              <option value="birthday">Birthday</option>
              <option value="anniversary">Anniversary</option>
              <option value="congratulations">Congratulations</option>
              <option value="condolence">Condolence</option>
              <option value="festival">Festival</option>
              <option value="other">Other</option>
            </select>
          </label>
          {text("recipient_name", "Recipient name")}
          {textarea("message_text", "Message", true)}
          {text("sender_names", "Sender names (comma separated)", true)}
        </div>
      );
    case "vehicles":
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {text("make", "Make", true)}
            {text("model", "Model", true)}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {number("year", "Year", true)}
            {number("kilometers", "Kilometers")}
            {text("fuel_type", "Fuel (petrol/diesel/cng/electric/hybrid/other)")}
          </div>
          {text("location", "Location", true)}
          {text("contact_phones", "Contact phones (comma separated)", true)}
          {text("expected_price", "Expected price (optional)")}
        </div>
      );
    default:
      return (
        <div className="rounded-md bg-accent-bg p-4 text-caption text-text-secondary">
          This type isn&apos;t wired to a custom form yet. Use the JSON view (top-right) to fill
          fields until Phase 9 lands the full form. Example:
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-caption text-text-primary">
{`{ "field1": "value", "field2": 123 }`}
          </pre>
        </div>
      );
  }
}

function JsonModeEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (s: string) => void;
}): React.ReactElement {
  return (
    <label className="block">
      <span className="mb-1 block text-label-caps text-text-secondary">
        Fields (JSON)
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={10}
        className="w-full rounded-md border-[1.5px] border-border-default bg-bg-surface px-3 py-2 font-mono text-caption text-text-primary focus:border-accent focus:outline-none"
      />
    </label>
  );
}

/**
 * Convert form-typed fields into the shape the validator expects.
 * Notably: comma-separated phone strings become arrays.
 */
function normalizeFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...fields };
  for (const key of ["contact_phones", "sender_names"]) {
    const raw = out[key];
    if (typeof raw === "string") {
      const parts = raw
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (parts.length > 0) {
        out[key] = parts;
      } else {
        delete out[key];
      }
    }
  }
  // Drop empty strings so Zod optional fields stay optional
  for (const key of Object.keys(out)) {
    if (out[key] === "" || out[key] === undefined) delete out[key];
  }
  return out;
}
