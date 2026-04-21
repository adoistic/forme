import React, { useState } from "react";
import { useIssueStore, useShallow } from "../../stores/issue.js";
import { useToast } from "../../components/Toast.js";
import { invoke } from "../../ipc/client.js";
import { describeError } from "../../lib/error-helpers.js";
import type { AdSlotType } from "@shared/schemas/ad.js";
import type { AdSummary } from "@shared/ipc-contracts/channels.js";

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

export function AdsScreen(): React.ReactElement {
  const { currentIssue, ads, refreshAds, refreshIssues } = useIssueStore(
    useShallow((s) => ({
      currentIssue: s.currentIssue,
      ads: s.ads,
      refreshAds: s.refreshAds,
      refreshIssues: s.refreshIssues,
    }))
  );
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [slotType, setSlotType] = useState<AdSlotType>("full_page");
  const [positionLabel, setPositionLabel] = useState("Run of Book");
  const [kind, setKind] = useState<AdSummary["kind"]>("commercial");
  const [bwFlag, setBwFlag] = useState(false);
  const [billing, setBilling] = useState("");

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const base64 = bytesToBase64(buf);
      await invoke("ad:upload", {
        issueId: currentIssue?.id ?? null,
        slotType,
        positionLabel,
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
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border-default px-8">
        <div>
          <h1 className="font-display text-display-md text-text-primary">Ads</h1>
          <div className="text-caption text-text-tertiary">
            {ads.length} uploaded · strict aspect-ratio + DPI validation on upload
          </div>
        </div>
      </header>

      {/* Upload panel */}
      <section className="border-b border-border-default px-8 py-4">
        <div className="mx-auto max-w-[920px] rounded-lg border border-border-default bg-bg-surface p-4">
          <div className="mb-3 text-label-caps text-text-secondary">Upload a creative</div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-label-caps text-text-tertiary">Slot type</span>
              <select
                value={slotType}
                onChange={(e) => setSlotType(e.target.value as AdSlotType)}
                className="w-full rounded-md border-[1.5px] border-border-default bg-bg-surface px-3 py-2 text-body focus:border-accent focus:outline-none"
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
              <span className="mb-1 block text-label-caps text-text-tertiary">Position</span>
              <input
                type="text"
                value={positionLabel}
                onChange={(e) => setPositionLabel(e.target.value)}
                placeholder="Back Cover / Run of Book / ..."
                className="w-full rounded-md border-[1.5px] border-border-default bg-bg-surface px-3 py-2 text-body focus:border-accent focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-label-caps text-text-tertiary">Kind</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as AdSummary["kind"])}
                className="w-full rounded-md border-[1.5px] border-border-default bg-bg-surface px-3 py-2 text-body focus:border-accent focus:outline-none"
              >
                <option value="commercial">Commercial</option>
                <option value="house">House</option>
                <option value="sponsor_strip">Sponsor strip</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-label-caps text-text-tertiary">Billing ref</span>
              <input
                type="text"
                value={billing}
                onChange={(e) => setBilling(e.target.value)}
                placeholder="internal only"
                className="w-full rounded-md border-[1.5px] border-border-default bg-bg-surface px-3 py-2 text-body focus:border-accent focus:outline-none"
              />
            </label>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <label className="flex items-center gap-2 text-caption text-text-secondary">
              <input
                type="checkbox"
                checked={bwFlag}
                onChange={(e) => setBwFlag(e.target.checked)}
              />
              Black and white
            </label>
            <div className="flex-1" />
            <label
              className="cursor-pointer rounded-md bg-accent px-4 py-2 text-title-sm font-semibold text-text-inverse hover:bg-accent-hover"
              data-testid="ad-upload-button"
            >
              {uploading ? "Uploading..." : "Choose ad file"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFile}
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
              <div className="mb-2 text-label-caps text-accent">NO ADS YET</div>
              <h2 className="mb-3 font-display text-display-md text-text-primary">
                Upload your first ad.
              </h2>
              <p className="text-body text-text-secondary">
                Pick a slot type above (aspect ratio enforced to 1% tolerance),
                then click <strong>Choose ad file</strong>. Sub-300 DPI uploads get warned;
                sub-150 DPI uploads are rejected.
              </p>
            </div>
          </div>
        ) : (
          <AdList ads={ads} />
        )}
      </div>
    </div>
  );
}

function AdList({
  ads,
}: {
  ads: AdSummary[];
}): React.ReactElement {
  return (
    <div className="mx-auto max-w-[920px]">
      <ul className="divide-y divide-border-default rounded-lg border border-border-default bg-bg-surface">
        {ads.map((ad) => (
          <li key={ad.id} className="flex items-center gap-4 px-4 py-3" data-testid={`ad-row-${ad.id}`}>
            <div className="flex-1 min-w-0">
              <div className="truncate text-body text-text-primary">{ad.creativeFilename}</div>
              <div className="text-caption text-text-tertiary">
                {SLOT_LABELS[ad.slotType]} · {ad.positionLabel}
              </div>
            </div>
            <span className="rounded-full bg-accent-bg px-2 py-0.5 text-label-caps text-accent">
              {ad.kind}
            </span>
            {ad.bwFlag ? (
              <span className="rounded-full bg-border-default px-2 py-0.5 text-label-caps text-text-secondary">BW</span>
            ) : (
              <span className="rounded-full bg-border-default px-2 py-0.5 text-label-caps text-text-secondary">COLOR</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
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
