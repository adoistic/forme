import React, { useState } from "react";
import { invoke } from "../../ipc/client.js";
import { useToast } from "../../components/Toast.js";
import { describeError } from "../../lib/error-helpers.js";
import type { ArticleSummary } from "@shared/ipc-contracts/channels.js";
import type { BylinePosition } from "@shared/schemas/article.js";

interface Props {
  article: ArticleSummary;
  onClose: () => void;
  onSaved: (updated: ArticleSummary) => void;
}

// Edit headline, deck, byline, and byline position. The latter is the key
// addition — news/features usually carry a byline at the top; editorials
// and wire-credited pieces use end-of-article "— By X" instead. This modal
// is the only place an operator can set it.
export function EditArticleModal({ article, onClose, onSaved }: Props): React.ReactElement {
  const toast = useToast();
  const [headline, setHeadline] = useState(article.headline);
  const [deck, setDeck] = useState(article.deck ?? "");
  const [byline, setByline] = useState(article.byline ?? "");
  const [bylinePosition, setBylinePosition] = useState<BylinePosition>(
    article.bylinePosition
  );
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!headline.trim()) return;
    setBusy(true);
    try {
      const updated = await invoke("article:update", {
        id: article.id,
        headline: headline.trim(),
        deck: deck.trim() || null,
        byline: byline.trim() || null,
        bylinePosition,
      });
      onSaved(updated);
    } catch (err) {
      toast.push("error", describeError(err));
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
        className="max-h-[92vh] w-[600px] overflow-y-auto rounded-xl bg-bg-surface p-8 shadow-lg"
        data-testid="edit-article-modal"
      >
        <div className="mb-1 text-label-caps text-accent">EDIT ARTICLE</div>
        <h2 className="mb-6 font-display text-display-md text-text-primary">
          Article details
        </h2>

        <label className="mb-4 block">
          <span className="mb-1 block text-label-caps text-text-secondary">Headline</span>
          <input
            autoFocus
            required
            type="text"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            className="w-full rounded-md border-[1.5px] border-border-default bg-bg-surface px-3 py-2.5 text-body focus:border-accent focus:outline-none"
            data-testid="edit-article-headline"
          />
        </label>

        <label className="mb-4 block">
          <span className="mb-1 block text-label-caps text-text-secondary">
            Deck <span className="ml-1 italic text-text-tertiary">optional subtitle</span>
          </span>
          <textarea
            value={deck}
            onChange={(e) => setDeck(e.target.value)}
            rows={2}
            placeholder="A brief description printed below the headline."
            className="w-full rounded-md border-[1.5px] border-border-default bg-bg-surface px-3 py-2 text-body focus:border-accent focus:outline-none"
            data-testid="edit-article-deck"
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-label-caps text-text-secondary">
            Byline <span className="ml-1 italic text-text-tertiary">optional — leave blank for no author</span>
          </span>
          <input
            type="text"
            value={byline}
            onChange={(e) => setByline(e.target.value)}
            placeholder="By Jane Doe"
            className="w-full rounded-md border-[1.5px] border-border-default bg-bg-surface px-3 py-2.5 text-body focus:border-accent focus:outline-none"
            data-testid="edit-article-byline"
          />
        </label>

        <div className="mb-6">
          <span className="mb-1 block text-label-caps text-text-secondary">
            Byline position
          </span>
          <div className="flex gap-1" role="radiogroup" aria-label="Byline position">
            {(["top", "end"] as const).map((pos) => (
              <button
                key={pos}
                type="button"
                role="radio"
                aria-checked={bylinePosition === pos}
                onClick={() => setBylinePosition(pos)}
                className={[
                  "flex-1 rounded-full px-4 py-1.5 text-title-sm transition-colors",
                  bylinePosition === pos
                    ? "bg-accent text-text-inverse"
                    : "text-text-secondary hover:bg-black/[0.04]",
                ].join(" ")}
                data-testid={`edit-article-byline-position-${pos}`}
              >
                {pos === "top" ? "Top (under deck)" : "End (after body)"}
              </button>
            ))}
          </div>
          <p className="mt-2 text-caption text-text-tertiary">
            Editorials and wire-credited pieces typically use <strong>End</strong>. News
            and features use <strong>Top</strong>.
          </p>
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-title-sm text-text-secondary hover:bg-black/[0.04]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !headline.trim()}
            className="rounded-md bg-accent px-5 py-2 text-title-sm font-semibold text-text-inverse hover:bg-accent-hover disabled:opacity-40"
            data-testid="edit-article-submit"
          >
            {busy ? "Saving..." : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
