import React, { useState } from "react";
import { useIssueStore, useShallow } from "../../stores/issue.js";
import { useToast } from "../../components/Toast.js";
import { invoke } from "../../ipc/client.js";
import { describeError } from "../../lib/error-helpers.js";
import { AddClassifiedModal } from "./AddClassifiedModal.js";
import type { ClassifiedType } from "@shared/schemas/classified.js";

const CLASSIFIED_TYPE_LABELS: Record<ClassifiedType, string> = {
  matrimonial_with_photo: "Matrimonial — with photo",
  matrimonial_no_photo: "Matrimonial — no photo",
  job_vacancy: "Job vacancy",
  job_wanted: "Job wanted",
  property_sale: "Property — sale",
  property_rent: "Property — rent",
  obituary: "Obituary",
  public_notice: "Public notice",
  announcement: "Announcement",
  tender_notice: "Tender notice",
  education: "Education",
  vehicles: "Vehicles",
};

export function ClassifiedsScreen(): React.ReactElement {
  const { currentIssue, classifieds, refreshClassifieds, refreshIssues } = useIssueStore(
    useShallow((s) => ({
      currentIssue: s.currentIssue,
      classifieds: s.classifieds,
      refreshClassifieds: s.refreshClassifieds,
      refreshIssues: s.refreshIssues,
    }))
  );
  const toast = useToast();
  const [adding, setAdding] = useState<ClassifiedType | null>(null);
  const [pickingType, setPickingType] = useState(false);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border-default px-8">
        <div>
          <h1 className="font-display text-display-md text-text-primary">Classifieds</h1>
          <div className="text-caption text-text-tertiary">
            {currentIssue
              ? `${classifieds.length} in ${currentIssue.title}`
              : `${classifieds.length} queued · no issue selected`}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setPickingType(true)}
          className="rounded-md bg-accent px-4 py-2 text-title-sm font-semibold text-text-inverse hover:bg-accent-hover"
          data-testid="add-classified-button"
        >
          + Add classified
        </button>
      </header>

      <div className="flex-1 overflow-auto p-8">
        {classifieds.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="max-w-[480px] text-center">
              <div className="mb-2 text-label-caps text-accent">NO CLASSIFIEDS YET</div>
              <h2 className="mb-3 font-display text-display-md text-text-primary">
                Add your first classified.
              </h2>
              <p className="text-body text-text-secondary">
                Click <strong>+ Add classified</strong> up top, pick a type, and fill in the form.
              </p>
            </div>
          </div>
        ) : (
          <ClassifiedList classifieds={classifieds} typeLabels={CLASSIFIED_TYPE_LABELS} />
        )}
      </div>

      {pickingType ? (
        <TypePicker
          onPick={(type) => {
            setPickingType(false);
            setAdding(type);
          }}
          onClose={() => setPickingType(false)}
        />
      ) : null}

      {adding ? (
        <AddClassifiedModal
          type={adding}
          issueId={currentIssue?.id ?? null}
          typeLabel={CLASSIFIED_TYPE_LABELS[adding]}
          onClose={() => setAdding(null)}
          onSaved={async () => {
            setAdding(null);
            await Promise.all([refreshClassifieds(), refreshIssues()]);
            toast.push("success", "Classified added to the queue.");
          }}
        />
      ) : null}
    </div>
  );
}

function ClassifiedList({
  classifieds,
  typeLabels,
}: {
  classifieds: import("@shared/ipc-contracts/channels.js").ClassifiedSummary[];
  typeLabels: Record<ClassifiedType, string>;
}): React.ReactElement {
  // Group by type
  const byType = new Map<ClassifiedType, typeof classifieds>();
  for (const c of classifieds) {
    const arr = byType.get(c.type) ?? [];
    arr.push(c);
    byType.set(c.type, arr);
  }

  return (
    <div className="mx-auto max-w-[920px] space-y-8">
      {[...byType.entries()].map(([type, entries]) => (
        <section key={type}>
          <h2 className="mb-3 font-display text-title-lg text-text-primary">
            {typeLabels[type]} <span className="text-text-tertiary">({entries.length})</span>
          </h2>
          <ul className="divide-y divide-border-default rounded-lg border border-border-default bg-bg-surface">
            {entries.map((c) => (
              <li key={c.id} className="flex items-center gap-4 px-4 py-3" data-testid={`classified-row-${c.id}`}>
                <div className="flex-1 min-w-0 truncate text-body text-text-primary">{c.displayName}</div>
                <span className="rounded-full bg-border-default px-2 py-0.5 text-label-caps text-text-secondary">
                  {c.language === "hi" ? "HI" : "EN"}
                </span>
                <span className="text-caption text-text-tertiary">
                  {c.weeksToRun} weeks
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function TypePicker({
  onPick,
  onClose,
}: {
  onPick: (type: ClassifiedType) => void;
  onClose: () => void;
}): React.ReactElement {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-bg-overlay"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[560px] rounded-xl bg-bg-surface p-8 shadow-lg"
      >
        <div className="mb-1 text-label-caps text-accent">NEW CLASSIFIED</div>
        <h2 className="mb-6 font-display text-display-md text-text-primary">Pick a type.</h2>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(CLASSIFIED_TYPE_LABELS) as ClassifiedType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onPick(t)}
              className="rounded-md border border-border-default px-4 py-3 text-left text-title-sm text-text-primary transition-colors hover:border-accent hover:bg-accent-bg"
              data-testid={`pick-type-${t}`}
            >
              {CLASSIFIED_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-title-sm text-text-secondary hover:bg-black/[0.04]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
