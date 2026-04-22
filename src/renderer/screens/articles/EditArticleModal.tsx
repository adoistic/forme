import React, { useState } from "react";
import { invoke } from "../../ipc/client.js";
import { useToast } from "../../components/Toast.js";
import { describeError } from "../../lib/error-helpers.js";
import type { ArticleSummary } from "@shared/ipc-contracts/channels.js";
import type {
  BylinePosition,
  HeroPlacement,
  ContentType,
} from "@shared/schemas/article.js";

interface Props {
  article: ArticleSummary;
  onClose: () => void;
  onSaved: (updated: ArticleSummary) => void;
}

const CONTENT_TYPES: ContentType[] = [
  "Article",
  "Photo Essay",
  "Interview",
  "Opinion",
  "Brief",
  "Letter",
  "Poem",
];

const HERO_PLACEMENT_OPTIONS: { value: HeroPlacement; label: string; hint: string }[] = [
  {
    value: "below-headline",
    label: "Below headline",
    hint: "Standard feature — image after byline.",
  },
  {
    value: "above-headline",
    label: "Above headline",
    hint: "Image-led — hero on top, headline beneath.",
  },
  {
    value: "full-bleed",
    label: "Full bleed",
    hint: "Image fills the page edge-to-edge; headline overlays.",
  },
];

/**
 * Article details editor — drives every per-article setting that
 * appears in the exported PPTX. The modal is the single place an
 * operator can override the auto-derived defaults the parser sets at
 * import time.
 */
export function EditArticleModal({ article, onClose, onSaved }: Props): React.ReactElement {
  const toast = useToast();
  const [headline, setHeadline] = useState(article.headline);
  const [deck, setDeck] = useState(article.deck ?? "");
  const [byline, setByline] = useState(article.byline ?? "");
  const [bylinePosition, setBylinePosition] = useState<BylinePosition>(
    article.bylinePosition
  );
  const [contentType, setContentType] = useState<ContentType>(article.contentType);
  const [heroPlacement, setHeroPlacement] = useState<HeroPlacement>(article.heroPlacement);
  const [heroCaption, setHeroCaption] = useState(article.heroCaption ?? "");
  const [heroCredit, setHeroCredit] = useState(article.heroCredit ?? "");
  const [section, setSection] = useState(article.section ?? "");
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
        contentType,
        heroPlacement,
        heroCaption: heroCaption.trim() || null,
        heroCredit: heroCredit.trim() || null,
        section: section.trim() || null,
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
        className="max-h-[92vh] w-[640px] overflow-y-auto rounded-xl bg-bg-surface p-8 shadow-lg"
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

        <div className="mb-4 grid grid-cols-2 gap-4">
          <label className="block">
            <span className="mb-1 block text-label-caps text-text-secondary">
              Byline <span className="ml-1 italic text-text-tertiary">optional</span>
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
          <label className="block">
            <span className="mb-1 block text-label-caps text-text-secondary">
              Section <span className="ml-1 italic text-text-tertiary">running header</span>
            </span>
            <input
              type="text"
              value={section}
              onChange={(e) => setSection(e.target.value)}
              placeholder="Features"
              className="w-full rounded-md border-[1.5px] border-border-default bg-bg-surface px-3 py-2.5 text-body focus:border-accent focus:outline-none"
              data-testid="edit-article-section"
            />
          </label>
        </div>

        <div className="mb-4">
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
        </div>

        <label className="mb-4 block">
          <span className="mb-1 block text-label-caps text-text-secondary">
            Content type
          </span>
          <select
            value={contentType}
            onChange={(e) => setContentType(e.target.value as ContentType)}
            className="w-full rounded-md border-[1.5px] border-border-default bg-bg-surface px-3 py-2.5 text-body focus:border-accent focus:outline-none"
            data-testid="edit-article-content-type"
          >
            {CONTENT_TYPES.map((ct) => (
              <option key={ct} value={ct}>
                {ct}
              </option>
            ))}
          </select>
          <p className="mt-1 text-caption text-text-tertiary">
            Drives template selection at export time. Photo Essay routes to the
            wide-margin two-column layout; Article uses the standard three-column.
          </p>
        </label>

        <fieldset className="mb-4 rounded-md border border-border-default p-4">
          <legend className="px-2 text-label-caps text-text-secondary">
            Hero image
          </legend>
          <div className="mb-3">
            <span className="mb-1 block text-label-caps text-text-secondary">
              Placement
            </span>
            <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label="Hero placement">
              {HERO_PLACEMENT_OPTIONS.map(({ value, label, hint }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={heroPlacement === value}
                  onClick={() => setHeroPlacement(value)}
                  title={hint}
                  className={[
                    "rounded-md border-[1.5px] px-2 py-2 text-title-sm transition-colors",
                    heroPlacement === value
                      ? "border-accent bg-accent-bg text-text-primary"
                      : "border-border-default text-text-secondary hover:border-border-strong",
                  ].join(" ")}
                  data-testid={`edit-article-hero-placement-${value}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-caption text-text-tertiary">
              {HERO_PLACEMENT_OPTIONS.find((o) => o.value === heroPlacement)?.hint}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-label-caps text-text-secondary">
                Caption
              </span>
              <input
                type="text"
                value={heroCaption}
                onChange={(e) => setHeroCaption(e.target.value)}
                placeholder="Auto: uses the deck"
                className="w-full rounded-md border-[1.5px] border-border-default bg-bg-surface px-3 py-2 text-body focus:border-accent focus:outline-none"
                data-testid="edit-article-hero-caption"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-label-caps text-text-secondary">
                Photographer credit
              </span>
              <input
                type="text"
                value={heroCredit}
                onChange={(e) => setHeroCredit(e.target.value)}
                placeholder="© Jane Doe / Magnum"
                className="w-full rounded-md border-[1.5px] border-border-default bg-bg-surface px-3 py-2 text-body focus:border-accent focus:outline-none"
                data-testid="edit-article-hero-credit"
              />
            </label>
          </div>
        </fieldset>

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
