import React, { useState } from "react";
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
import { AddClassifiedModal } from "./AddClassifiedModal.js";
import { JsonImportModal } from "./JsonImportModal.js";
import { ColumnReferencePanel } from "./ColumnReferencePanel.js";
import type { ClassifiedSummary } from "@shared/ipc-contracts/channels.js";
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
  const { currentIssue, classifieds, refreshClassifieds, refreshIssues, setClassifieds } =
    useIssueStore(
      useShallow((s) => ({
        currentIssue: s.currentIssue,
        classifieds: s.classifieds,
        refreshClassifieds: s.refreshClassifieds,
        refreshIssues: s.refreshIssues,
        setClassifieds: s.setClassifieds,
      }))
    );
  const toast = useToast();
  const [adding, setAdding] = useState<ClassifiedType | null>(null);
  const [pickingType, setPickingType] = useState(false);
  const [importing, setImporting] = useState(false);
  const [jsonImportOpen, setJsonImportOpen] = useState(false);
  const [downloadingSample, setDownloadingSample] = useState(false);

  async function handleDownloadSample(): Promise<void> {
    setDownloadingSample(true);
    try {
      const res = await invoke("classifieds:download-sample-csv", {});
      if (res) {
        toast.push("success", `Sample CSV saved to ${res.outputPath}.`);
      }
    } catch (err) {
      toast.push("error", describeError(err));
    } finally {
      setDownloadingSample(false);
    }
  }

  async function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const csv = await file.text();
      const res = await invoke("classified:import-csv", {
        csv,
        issueId: currentIssue?.id ?? null,
      });
      await Promise.all([refreshClassifieds(), refreshIssues()]);
      if (res.errors.length === 0) {
        toast.push(
          "success",
          `Imported ${res.imported} classified${res.imported === 1 ? "" : "s"}.`
        );
      } else {
        toast.push(
          res.imported > 0 ? "info" : "error",
          `Imported ${res.imported}, ${res.errors.length} row${res.errors.length === 1 ? "" : "s"} skipped (row ${res.errors[0]?.row}: ${res.errors[0]?.reason ?? "unknown"}).`
        );
      }
    } catch (err) {
      toast.push("error", describeError(err));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-border-default flex h-16 shrink-0 items-center justify-between border-b px-8">
        <div>
          <h1 className="font-display text-display-md text-text-primary">Classifieds</h1>
          <div className="text-caption text-text-tertiary">
            {currentIssue
              ? `${classifieds.length} in ${currentIssue.title}`
              : `${classifieds.length} queued · no issue selected`}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleDownloadSample}
            disabled={downloadingSample}
            className="text-title-sm text-text-secondary hover:text-text-primary rounded-md px-3 py-1.5 disabled:opacity-40"
            data-testid="download-sample-csv-button"
          >
            {downloadingSample ? "Saving..." : "Download sample CSV"}
          </button>
          <label
            className="border-accent text-title-sm text-accent hover:bg-accent-bg cursor-pointer rounded-md border-[1.5px] px-4 py-1.5"
            data-testid="import-csv-button"
          >
            {importing ? "Importing..." : "Import CSV"}
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleCsvUpload}
              data-testid="import-csv-input"
            />
          </label>
          <button
            type="button"
            onClick={() => setJsonImportOpen(true)}
            className="border-accent text-title-sm text-accent hover:bg-accent-bg rounded-md border-[1.5px] px-4 py-1.5"
            data-testid="import-json-button"
          >
            Import JSON
          </button>
          <button
            type="button"
            onClick={() => setPickingType(true)}
            className="bg-accent text-title-sm text-text-inverse hover:bg-accent-hover rounded-md px-4 py-2 font-semibold"
            data-testid="add-classified-button"
          >
            + Add classified
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8">
        <div className="mx-auto mb-6 max-w-[920px]">
          <ColumnReferencePanel typeLabels={CLASSIFIED_TYPE_LABELS} />
        </div>
        {classifieds.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <div className="max-w-[480px] text-center">
              <div className="text-label-caps text-accent mb-2">NO CLASSIFIEDS YET</div>
              <h2 className="font-display text-display-md text-text-primary mb-3">
                Add your first classified.
              </h2>
              <p className="text-body text-text-secondary">
                Click <strong>+ Add classified</strong> up top, pick a type, and fill in the form.
              </p>
            </div>
          </div>
        ) : (
          <ClassifiedList
            classifieds={classifieds}
            typeLabels={CLASSIFIED_TYPE_LABELS}
            onReorder={async (next, movedId, newPosition) => {
              setClassifieds(next);
              try {
                await invoke("classifieds:reorder", { classifiedId: movedId, newPosition });
                await refreshClassifieds();
              } catch (e) {
                toast.push("error", describeError(e));
                await refreshClassifieds();
              }
            }}
          />
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

      {jsonImportOpen ? (
        <JsonImportModal
          issueId={currentIssue?.id ?? null}
          onClose={() => setJsonImportOpen(false)}
          onImported={async (count) => {
            setJsonImportOpen(false);
            await Promise.all([refreshClassifieds(), refreshIssues()]);
            toast.push(
              "success",
              `Imported ${count} classified${count === 1 ? "" : "s"} from JSON.`
            );
          }}
        />
      ) : null}
    </div>
  );
}

function ClassifiedList({
  classifieds,
  typeLabels,
  onReorder,
}: {
  classifieds: ClassifiedSummary[];
  typeLabels: Record<ClassifiedType, string>;
  onReorder: (
    next: ClassifiedSummary[],
    movedId: string,
    newPosition: number
  ) => Promise<void> | void;
}): React.ReactElement {
  // Group by type — operators reorder within a type, not across types.
  // Drag-and-drop uses one DndContext per group so cross-group drops are
  // impossible (and cross-type drops would semantically be a re-categorize).
  const byType = new Map<ClassifiedType, ClassifiedSummary[]>();
  for (const c of classifieds) {
    const arr = byType.get(c.type) ?? [];
    arr.push(c);
    byType.set(c.type, arr);
  }

  function handleGroupReorder(
    type: ClassifiedType,
    nextGroup: ClassifiedSummary[],
    movedId: string,
    newPosition: number
  ): void {
    // Splice the reordered group back into the full list, preserving the
    // global section ordering (matches the iteration order of the map).
    const next: ClassifiedSummary[] = [];
    for (const [t, entries] of byType.entries()) {
      if (t === type) next.push(...nextGroup);
      else next.push(...entries);
    }
    void onReorder(next, movedId, newPosition);
  }

  return (
    <div className="mx-auto max-w-[920px] space-y-8">
      {[...byType.entries()].map(([type, entries]) => (
        <section key={type}>
          <h2 className="font-display text-title-lg text-text-primary mb-3">
            {typeLabels[type]} <span className="text-text-tertiary">({entries.length})</span>
          </h2>
          <ClassifiedGroup
            entries={entries}
            onReorder={(next, movedId, newPosition) =>
              handleGroupReorder(type, next, movedId, newPosition)
            }
          />
        </section>
      ))}
    </div>
  );
}

function ClassifiedGroup({
  entries,
  onReorder,
}: {
  entries: ClassifiedSummary[];
  onReorder: (next: ClassifiedSummary[], movedId: string, newPosition: number) => void;
}): React.ReactElement {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = entries.findIndex((c) => c.id === active.id);
    const newIndex = entries.findIndex((c) => c.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(entries, oldIndex, newIndex);
    const before = next[newIndex - 1];
    const after = next[newIndex + 1];
    const beforePos = before ? entries.findIndex((c) => c.id === before.id) + 1 : null;
    const afterPos = after ? entries.findIndex((c) => c.id === after.id) + 1 : null;
    const newPosition = computeRendererMidpoint(beforePos, afterPos);
    onReorder(next, String(active.id), newPosition);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={entries.map((e) => e.id)} strategy={verticalListSortingStrategy}>
        <ul className="divide-border-default border-border-default bg-bg-surface divide-y rounded-lg border">
          {entries.map((c) => (
            <SortableClassifiedRow key={c.id} classified={c} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableClassifiedRow({
  classified,
}: {
  classified: ClassifiedSummary;
}): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: classified.id,
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
      data-testid={`classified-row-${classified.id}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Reorder classified"
        className="text-text-tertiary hover:text-text-primary cursor-grab touch-none active:cursor-grabbing"
        data-testid={`classified-drag-handle-${classified.id}`}
      >
        <DotsSixVertical size={18} weight="bold" />
      </button>
      <div className="text-body text-text-primary min-w-0 flex-1 truncate">
        {classified.displayName}
      </div>
      <span className="bg-border-default text-label-caps text-text-secondary rounded-full px-2 py-0.5">
        {classified.language === "hi" ? "HI" : "EN"}
      </span>
      <span className="text-caption text-text-tertiary">{classified.weeksToRun} weeks</span>
    </li>
  );
}

function computeRendererMidpoint(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1;
  if (before === null) return (after as number) - 1;
  if (after === null) return (before as number) + 1;
  return (before + after) / 2;
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
      className="bg-bg-overlay fixed inset-0 z-40 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-bg-surface w-[560px] rounded-xl p-8 shadow-lg"
      >
        <div className="text-label-caps text-accent mb-1">NEW CLASSIFIED</div>
        <h2 className="font-display text-display-md text-text-primary mb-6">Pick a type.</h2>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(CLASSIFIED_TYPE_LABELS) as ClassifiedType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onPick(t)}
              className="border-border-default text-title-sm text-text-primary hover:border-accent hover:bg-accent-bg rounded-md border px-4 py-3 text-left transition-colors"
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
            className="text-title-sm text-text-secondary rounded-md px-4 py-2 hover:bg-black/[0.04]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
