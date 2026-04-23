import React, { useRef, useState } from "react";
import { invoke } from "../../ipc/client.js";
import { useToast } from "../Toast.js";
import { describeError } from "../../lib/error-helpers.js";
import type { ArticleSummary } from "@shared/ipc-contracts/channels.js";

/**
 * Self-contained hero upload affordance for an existing article. Wraps the
 * three operator paths (file picker, drag-drop, URL paste) and routes to
 * the matching IPC handler (`hero:upload-file` or `hero:upload-url`).
 *
 * Reused by EditArticleModal (T14 follow-on, v0.6) — NewArticleModal still
 * uses an inline staged version because the article doesn't exist yet at
 * that point.
 */
export interface HeroUploadSectionProps {
  articleId: string;
  /** Fired once the IPC returns; parent can fold the updated summary into its state. */
  onUploaded: (updated: ArticleSummary) => void;
}

type LocalState =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "ok"; lastFileName: string | null; previewUrl: string | null };

async function fileToBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader returned non-string"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.readAsDataURL(file);
  });
}

export function HeroUploadSection({
  articleId,
  onUploaded,
}: HeroUploadSectionProps): React.ReactElement {
  const toast = useToast();
  const [state, setState] = useState<LocalState>({ kind: "idle" });
  const [dragOver, setDragOver] = useState(false);
  const [urlExpanded, setUrlExpanded] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function uploadFile(file: File): Promise<void> {
    if (!file.type.startsWith("image/")) {
      toast.push("error", "That file isn't an image.");
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    setState({ kind: "uploading" });
    try {
      const base64 = await fileToBase64(file);
      const updated = await invoke("hero:upload-file", {
        articleId,
        base64,
        filename: file.name,
      });
      setState({ kind: "ok", lastFileName: file.name, previewUrl });
      onUploaded(updated);
      toast.push("success", "Hero image attached.");
    } catch (err) {
      URL.revokeObjectURL(previewUrl);
      setState({ kind: "idle" });
      toast.push("error", describeError(err));
    }
  }

  async function uploadUrl(url: string): Promise<void> {
    const trimmed = url.trim();
    if (!trimmed) return;
    setState({ kind: "uploading" });
    try {
      const updated = await invoke("hero:upload-url", { articleId, url: trimmed });
      setState({ kind: "ok", lastFileName: trimmed, previewUrl: null });
      setUrlDraft("");
      setUrlExpanded(false);
      onUploaded(updated);
      toast.push("success", "Hero image attached.");
    } catch (err) {
      setState({ kind: "idle" });
      toast.push("error", describeError(err));
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void uploadFile(file);
  }

  // Confirmed-uploaded state — show a small preview row + "Replace" link.
  if (state.kind === "ok") {
    return (
      <div className="flex items-center gap-4" data-testid="hero-upload-section-uploaded">
        {state.previewUrl ? (
          <img
            src={state.previewUrl}
            alt="Hero preview"
            className="border-border-default h-16 w-16 rounded-md border object-cover"
          />
        ) : (
          <div className="border-border-default bg-bg-canvas flex h-16 w-16 items-center justify-center rounded-md border">
            <span className="text-label-caps text-text-tertiary">URL</span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-label-caps text-text-secondary">HERO IMAGE</div>
          <div className="text-caption text-text-primary truncate" title={state.lastFileName ?? ""}>
            {state.lastFileName ?? "Attached"}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
            setState({ kind: "idle" });
          }}
          className="text-caption text-text-secondary hover:text-text-primary rounded-md px-3 py-1.5 hover:bg-black/[0.04]"
          data-testid="hero-upload-section-replace"
        >
          Replace
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="hero-upload-section">
      <div
        role="button"
        tabIndex={0}
        aria-disabled={state.kind === "uploading"}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragOver) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={[
          "flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed py-6 text-center transition-colors",
          dragOver
            ? "border-accent bg-accent-bg"
            : "border-border-dashed bg-bg-canvas hover:bg-black/[0.02]",
          state.kind === "uploading" ? "pointer-events-none opacity-60" : "",
        ].join(" ")}
        data-testid="hero-upload-section-dropzone"
      >
        <span className="text-title-sm text-text-primary">
          {state.kind === "uploading" ? "Uploading..." : "Drop a hero image here"}
        </span>
        <span className="text-caption text-text-secondary">
          or click to choose a file (PNG, JPG, WebP)
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void uploadFile(file);
            // Reset so picking the same file twice still fires onChange.
            e.target.value = "";
          }}
          data-testid="hero-upload-section-file-input"
        />
      </div>
      {urlExpanded ? (
        <div className="flex items-center gap-2">
          <input
            type="url"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            placeholder="https://example.com/hero.jpg"
            className="border-border-default bg-bg-surface text-caption text-text-primary focus:border-accent flex-1 rounded-md border px-3 py-1.5 focus:outline-none"
            data-testid="hero-upload-section-url-input"
            autoFocus
          />
          <button
            type="button"
            onClick={() => void uploadUrl(urlDraft)}
            disabled={!urlDraft.trim() || state.kind === "uploading"}
            className="bg-accent text-caption text-text-inverse hover:bg-accent-hover rounded-md px-3 py-1.5 font-semibold disabled:opacity-40"
            data-testid="hero-upload-section-url-confirm"
          >
            Use URL
          </button>
          <button
            type="button"
            onClick={() => setUrlExpanded(false)}
            className="text-caption text-text-secondary rounded-md px-2 py-1.5 hover:bg-black/[0.04]"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setUrlExpanded(true)}
          className="text-caption text-text-secondary hover:text-accent self-center underline-offset-2 hover:underline"
          data-testid="hero-upload-section-url-toggle"
        >
          Or paste a URL
        </button>
      )}
    </div>
  );
}
