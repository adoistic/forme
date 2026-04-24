import React, { useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DotsSixVertical } from "@phosphor-icons/react";
import { useIssueStore, useShallow } from "../../stores/issue.js";
import { useToast } from "../../components/Toast.js";
import { invoke } from "../../ipc/client.js";
import { describeError } from "../../lib/error-helpers.js";
import type { AdSlotType } from "@shared/schemas/ad.js";
import type { AdPlacementKind, AdSummary, ArticleSummary } from "@shared/ipc-contracts/channels.js";

const SLOT_LABELS: Record<AdSlotType, string> = {
  full_page: "Full page (A4 portrait)",
  double_page_spread: "Double-page spread",
  half_page_horizontal: "Half page (horizontal)",
  half_page_vertical: "Half page (vertical)",
  quarter_page: "Quarter page",
  strip: "Strip (bottom/top)",
  vertical_strip: "Vertical strip",
  eighth_page: "Eighth page",
  cover_strip: "Cover strip",
  corner_bookmark: "Corner bookmark",
  section_sponsor_strip: "Section sponsor strip",
};

const PLACEMENT_OPTIONS: ReadonlyArray<{ value: AdPlacementKind; label: string }> = [
  { value: "cover", label: "Cover (full-page or section opener)" },
  { value: "between", label: "Between articles" },
  { value: "bottom-of", label: "Bottom of an article" },
];

// Render an article into "after Kabir's piece"-style helper text. Falls
// back to the bare headline when there's no byline.
function bylineCaption(article: ArticleSummary, kind: AdPlacementKind): string {
  const author = (article.byline ?? "").trim().split(/\s+/)[0];
  if (!author) return article.headline;
  return kind === "between" ? `after ${author}'s piece` : `under ${author}'s piece`;
}

// Renderer-side gate matching the main-process validatePlacement. Returns
// the user-facing message for a Save attempt or null when the form is
// ready. Keeps the form's submit button disabled until placement is valid.
export function placementValidationMessage(
  kind: AdPlacementKind,
  articleId: string | null
): string | null {
  if (kind === "cover") return null;
  if (!articleId) return "Pick the article this ad should sit with.";
  return null;
}

export function AdsScreen(): React.ReactElement {
  const { currentIssue, ads, articles, refreshAds, refreshIssues, setAds } = useIssueStore(
    useShallow((s) => ({
      currentIssue: s.currentIssue,
      ads: s.ads,
      articles: s.articles,
      refreshAds: s.refreshAds,
      refreshIssues: s.refreshIssues,
      setAds: s.setAds,
    }))
  );
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [slotType, setSlotType] = useState<AdSlotType>("full_page");
  const [placementKind, setPlacementKind] = useState<AdPlacementKind>("cover");
  const [placementArticleId, setPlacementArticleId] = useState<string | null>(null);
  const [kind, setKind] = useState<AdSummary["kind"]>("commercial");
  const [bwFlag, setBwFlag] = useState(false);
  const [billing, setBilling] = useState("");

  // Articles in display_position order — the article-picker order matches
  // what the operator sees on the Articles screen so the "between" choice
  // reads naturally.
  const orderedArticles = useMemo(() => articles.slice(), [articles]);

  const placementError = placementValidationMessage(placementKind, placementArticleId);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (placementError) {
      toast.push("error", placementError);
      return;
    }
    setUploading(true);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const base64 = bytesToBase64(buf);
      await invoke("ad:upload", {
        issueId: currentIssue?.id ?? null,
        slotType,
        placementKind,
        placementArticleId: placementKind === "cover" ? null : placementArticleId,
        bwFlag,
        kind,
        billingReference: billing.trim() || null,
        base64,
        filename: file.name,
        mimeType: file.type || "image/jpeg",
      });
      await Promise.all([refreshAds(), refreshIssues()]);
      toast.push("success", `Uploaded ${file.name}.`);
    } catch (err) {
      toast.push("error", describeError(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-border-default flex h-16 shrink-0 items-center justify-between border-b px-8">
        <div>
          <h1 className="font-display text-display-md text-text-primary">Ads</h1>
          <div className="text-caption text-text-tertiary">
            {ads.length} uploaded · strict aspect-ratio + DPI validation on upload
          </div>
        </div>
      </header>

      {/* Upload panel */}
      <section className="border-border-default border-b px-8 py-4">
        <div className="border-border-default bg-bg-surface mx-auto max-w-[920px] rounded-lg border p-4">
          <div className="text-label-caps text-text-secondary mb-3">Upload a creative</div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <label className="block">
              <span className="text-label-caps text-text-tertiary mb-1 block">Slot type</span>
              <select
                value={slotType}
                onChange={(e) => setSlotType(e.target.value as AdSlotType)}
                className="border-border-default bg-bg-surface text-body focus:border-accent w-full rounded-md border-[1.5px] px-3 py-2 focus:outline-none"
                data-testid="ad-slot-type"
              >
                {(Object.keys(SLOT_LABELS) as AdSlotType[]).map((s) => (
                  <option key={s} value={s}>
                    {SLOT_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-label-caps text-text-tertiary mb-1 block">Kind</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as AdSummary["kind"])}
                className="border-border-default bg-bg-surface text-body focus:border-accent w-full rounded-md border-[1.5px] px-3 py-2 focus:outline-none"
              >
                <option value="commercial">Commercial</option>
                <option value="house">House</option>
                <option value="sponsor_strip">Sponsor strip</option>
              </select>
            </label>
            <label className="block">
              <span className="text-label-caps text-text-tertiary mb-1 block">Billing ref</span>
              <input
                type="text"
                value={billing}
                onChange={(e) => setBilling(e.target.value)}
                placeholder="internal only"
                className="border-border-default bg-bg-surface text-body focus:border-accent w-full rounded-md border-[1.5px] px-3 py-2 focus:outline-none"
              />
            </label>
          </div>

          {/* v0.6 T15: structured placement. Radio group + conditional
              article picker. The placement controls are full-width because
              the article picker can grow to many lines. */}
          <fieldset className="mt-4" data-testid="ad-placement-fieldset">
            <legend className="text-label-caps text-text-tertiary mb-2 block">Placement</legend>
            <div className="flex flex-col gap-2">
              {PLACEMENT_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="text-body text-text-primary flex items-center gap-2"
                >
                  <input
                    type="radio"
                    name="ad-placement-kind"
                    value={opt.value}
                    checked={placementKind === opt.value}
                    onChange={() => {
                      setPlacementKind(opt.value);
                      if (opt.value === "cover") setPlacementArticleId(null);
                    }}
                    className="accent-accent"
                    data-testid={`ad-placement-${opt.value}`}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
            {placementKind !== "cover" && (
              <div className="mt-3">
                <label className="block">
                  <span className="text-label-caps text-text-tertiary mb-1 block">Article</span>
                  <select
                    value={placementArticleId ?? ""}
                    onChange={(e) => setPlacementArticleId(e.target.value || null)}
                    className="border-border-default bg-bg-surface text-body focus:border-accent w-full rounded-md border-[1.5px] px-3 py-2 focus:outline-none"
                    data-testid="ad-placement-article"
                  >
                    <option value="">Choose an article...</option>
                    {orderedArticles.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.headline} ({bylineCaption(a, placementKind)})
                      </option>
                    ))}
                  </select>
                </label>
                {orderedArticles.length === 0 && (
                  <div className="text-caption text-text-tertiary mt-1">
                    No articles in this issue yet. Add an article first, then return here.
                  </div>
                )}
              </div>
            )}
            {placementError && (
              <div
                className="text-caption text-error mt-2"
                data-testid="ad-placement-error"
                role="alert"
              >
                {placementError}
              </div>
            )}
          </fieldset>

          <div className="mt-3 flex items-center gap-3">
            <label className="text-caption text-text-secondary flex items-center gap-2">
              <input
                type="checkbox"
                checked={bwFlag}
                onChange={(e) => setBwFlag(e.target.checked)}
              />
              Black and white
            </label>
            <div className="flex-1" />
            <label
              className={
                "bg-accent text-title-sm text-text-inverse hover:bg-accent-hover rounded-md px-4 py-2 font-semibold " +
                (placementError ? "cursor-not-allowed opacity-60" : "cursor-pointer")
              }
              data-testid="ad-upload-button"
            >
              {uploading ? "Uploading..." : "Choose ad file"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFile}
                disabled={!!placementError}
                data-testid="ad-upload-input"
              />
            </label>
          </div>
        </div>
      </section>

      <div className="flex-1 overflow-auto p-8">
        {ads.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="max-w-[480px] text-center">
              <div className="text-label-caps text-accent mb-2">NO ADS YET</div>
              <h2 className="font-display text-display-md text-text-primary mb-3">
                Upload your first ad.
              </h2>
              <p className="text-body text-text-secondary">
                Pick a slot type above (aspect ratio enforced to 1% tolerance), then click{" "}
                <strong>Choose ad file</strong>. Sub-300 DPI uploads get warned; sub-150 DPI uploads
                are rejected.
              </p>
            </div>
          </div>
        ) : (
          <AdList
            ads={ads}
            articles={orderedArticles}
            onReorder={async (next, movedId, newPosition) => {
              setAds(next);
              try {
                await invoke("ads:reorder", { adId: movedId, newPosition });
                await refreshAds();
              } catch (e) {
                toast.push("error", describeError(e));
                await refreshAds();
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

function AdList({
  ads,
  articles,
  onReorder,
}: {
  ads: AdSummary[];
  articles: ArticleSummary[];
  onReorder: (next: AdSummary[], movedId: string, newPosition: number) => Promise<void> | void;
}): React.ReactElement {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ads.findIndex((a) => a.id === active.id);
    const newIndex = ads.findIndex((a) => a.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(ads, oldIndex, newIndex);
    const before = next[newIndex - 1];
    const after = next[newIndex + 1];
    const beforePos = before ? ads.findIndex((a) => a.id === before.id) + 1 : null;
    const afterPos = after ? ads.findIndex((a) => a.id === after.id) + 1 : null;
    const newPosition = computeRendererMidpoint(beforePos, afterPos);
    void onReorder(next, String(active.id), newPosition);
  }

  return (
    <div className="mx-auto max-w-[920px]">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ads.map((a) => a.id)} strategy={verticalListSortingStrategy}>
          <ul className="divide-border-default border-border-default bg-bg-surface divide-y rounded-lg border">
            {ads.map((ad) => (
              <SortableAdRow key={ad.id} ad={ad} articles={articles} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function placementSummary(ad: AdSummary, articles: ArticleSummary[]): string {
  if (ad.placementKind === "cover") return "Cover";
  const host = articles.find((a) => a.id === ad.placementArticleId);
  const headline = host?.headline ?? "(unlinked)";
  return ad.placementKind === "between"
    ? `Between articles · after ${headline}`
    : `Bottom of · ${headline}`;
}

function SortableAdRow({
  ad,
  articles,
}: {
  ad: AdSummary;
  articles: ArticleSummary[];
}): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: ad.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 px-4 py-3"
      data-testid={`ad-row-${ad.id}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Reorder ad"
        className="text-text-tertiary hover:text-text-primary cursor-grab touch-none active:cursor-grabbing"
        data-testid={`ad-drag-handle-${ad.id}`}
      >
        <DotsSixVertical size={18} weight="bold" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-body text-text-primary truncate">{ad.creativeFilename}</div>
        <div className="text-caption text-text-tertiary">
          {SLOT_LABELS[ad.slotType]} · {placementSummary(ad, articles)}
        </div>
      </div>
      <span className="bg-accent-bg text-label-caps text-accent rounded-full px-2 py-0.5">
        {ad.kind}
      </span>
      {ad.bwFlag ? (
        <span className="bg-border-default text-label-caps text-text-secondary rounded-full px-2 py-0.5">
          BW
        </span>
      ) : (
        <span className="bg-border-default text-label-caps text-text-secondary rounded-full px-2 py-0.5">
          COLOR
        </span>
      )}
    </li>
  );
}

function computeRendererMidpoint(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1;
  if (before === null) return (after as number) - 1;
  if (after === null) return (before as number) + 1;
  return (before + after) / 2;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}
