import React, { useState } from "react";
import { invoke } from "../../ipc/client.js";
import { useToast } from "../../components/Toast.js";
import { describeError } from "../../lib/error-helpers.js";
import type { Language } from "@shared/schemas/language.js";

interface Props {
  onClose: () => void;
  onCreated: () => Promise<void>;
}

export function CreateIssueModal({ onClose, onCreated }: Props): React.ReactElement {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [issueNumber, setIssueNumber] = useState<string>("1");
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [pageSize, setPageSize] = useState<"A4" | "A5">("A4");
  const [language, setLanguage] = useState<Language>("en");
  const [pairing, setPairing] = useState("Editorial Serif");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await invoke("issue:create", {
        title: title.trim(),
        issueNumber: issueNumber ? Number.parseInt(issueNumber, 10) : null,
        issueDate,
        pageSize,
        typographyPairing: pairing,
        primaryLanguage: language,
        bwMode: false,
      });
      await onCreated();
    } catch (thrown: unknown) {
      toast.push("error", describeError(thrown));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-bg-overlay"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-[560px] rounded-xl bg-bg-surface p-8 shadow-lg"
        data-testid="create-issue-modal"
      >
        <div className="mb-1 text-label-caps text-accent">NEW ISSUE</div>
        <h2 className="mb-6 font-display text-display-lg text-text-primary">Start a new issue.</h2>

        <label className="mb-4 block">
          <span className="mb-1 block text-label-caps text-text-secondary">Title</span>
          <input
            autoFocus
            required
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="The Daily Saptahik"
            className="w-full rounded-md border-[1.5px] border-border-default bg-bg-surface px-3 py-2.5 text-body focus:border-accent focus:outline-none"
            data-testid="create-issue-title"
          />
        </label>

        <div className="mb-4 grid grid-cols-2 gap-4">
          <label className="block">
            <span className="mb-1 block text-label-caps text-text-secondary">Issue number</span>
            <input
              type="number"
              min={1}
              value={issueNumber}
              onChange={(e) => setIssueNumber(e.target.value)}
              className="w-full rounded-md border-[1.5px] border-border-default bg-bg-surface px-3 py-2.5 text-body focus:border-accent focus:outline-none"
              data-testid="create-issue-number"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-label-caps text-text-secondary">Date</span>
            <input
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className="w-full rounded-md border-[1.5px] border-border-default bg-bg-surface px-3 py-2.5 text-body focus:border-accent focus:outline-none"
              data-testid="create-issue-date"
            />
          </label>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-4">
          <label className="block">
            <span className="mb-1 block text-label-caps text-text-secondary">Page size</span>
            <div className="flex gap-2">
              {(["A4", "A5"] as const).map((sz) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => setPageSize(sz)}
                  className={[
                    "flex-1 rounded-md border-[1.5px] px-3 py-2 text-title-sm transition-colors",
                    pageSize === sz
                      ? "border-accent bg-accent-bg text-text-primary"
                      : "border-border-default text-text-secondary hover:border-border-strong",
                  ].join(" ")}
                >
                  {sz}
                </button>
              ))}
            </div>
          </label>

          <label className="block">
            <span className="mb-1 block text-label-caps text-text-secondary">Language</span>
            <div className="flex gap-1">
              {(["en", "hi", "bilingual"] as Language[]).map((l) => (
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
                  {l === "en" ? "English" : l === "hi" ? "Hindi" : "Both"}
                </button>
              ))}
            </div>
          </label>
        </div>

        <label className="mb-6 block">
          <span className="mb-1 block text-label-caps text-text-secondary">Typography pairing</span>
          <select
            value={pairing}
            onChange={(e) => setPairing(e.target.value)}
            className="w-full rounded-md border-[1.5px] border-border-default bg-bg-surface px-3 py-2.5 text-body focus:border-accent focus:outline-none"
          >
            <option>Editorial Serif</option>
            <option>News Sans</option>
            <option>Literary</option>
            <option>Modern Geometric</option>
          </select>
        </label>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-title-sm text-text-secondary hover:bg-black/[0.04]"
            data-testid="create-issue-cancel"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !title.trim()}
            className="rounded-md bg-accent px-5 py-2 text-title-sm font-semibold text-text-inverse hover:bg-accent-hover disabled:opacity-40"
            data-testid="create-issue-submit"
          >
            {busy ? "Creating..." : "Create issue"}
          </button>
        </div>
      </form>
    </div>
  );
}
