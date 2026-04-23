import React, { useState } from "react";
import {
  SquaresFour,
  FileText,
  ListBullets,
  Megaphone,
  Images,
  SquareHalf,
  ClockCounterClockwise,
  GearSix,
} from "@phosphor-icons/react";
import { useNavStore, useShallow as useNavShallow, type TabId } from "../stores/navigation.js";
import { useIssueStore, useShallow as useIssueShallow } from "../stores/issue.js";
import { useToast } from "./Toast.js";
import { invoke } from "../ipc/client.js";
import { describeError } from "../lib/error-helpers.js";

interface NavItem {
  id: TabId;
  label: string;
  Icon: React.ComponentType<{ size?: number; weight?: "regular" | "bold"; className?: string }>;
}

// 8-tab IA locked by CEO review Section 11 decision.
const NAV_ITEMS: readonly NavItem[] = [
  { id: "issue-board", label: "Issue Board", Icon: SquaresFour },
  { id: "articles", label: "Articles", Icon: FileText },
  { id: "classifieds", label: "Classifieds", Icon: ListBullets },
  { id: "ads", label: "Ads", Icon: Megaphone },
  { id: "images", label: "Images", Icon: Images },
  { id: "templates", label: "Templates", Icon: SquareHalf },
  { id: "history", label: "History", Icon: ClockCounterClockwise },
  { id: "settings", label: "Settings", Icon: GearSix },
];

export function Sidebar(): React.ReactElement {
  const { activeTab, setActiveTab } = useNavStore(
    useNavShallow((s) => ({ activeTab: s.activeTab, setActiveTab: s.setActiveTab }))
  );
  const { currentIssue, articles } = useIssueStore(
    useIssueShallow((s) => ({ currentIssue: s.currentIssue, articles: s.articles }))
  );
  const toast = useToast();
  const [exporting, setExporting] = useState(false);

  async function handleExport(): Promise<void> {
    if (!currentIssue) return;
    setExporting(true);
    try {
      const result = await invoke("export:pptx", { issueId: currentIssue.id });
      // Operator cancelled the save dialog — silent no-op per CEO plan.
      if (result.canceled || !result.outputPath) return;
      const filename = result.outputPath.split(/[\\/]/).pop() ?? result.outputPath;
      const savedPath = result.outputPath;
      toast.push("success", `Exported to ${filename}`, {
        label: "Reveal in Finder",
        onClick: () => {
          void invoke("shell:reveal", { path: savedPath });
        },
      });
    } catch (err) {
      toast.push("error", describeError(err));
    } finally {
      setExporting(false);
    }
  }

  const canExport = !!currentIssue && articles.length > 0 && !exporting;

  return (
    <aside
      aria-label="Primary"
      className="border-border-default bg-bg-canvas flex h-full w-[260px] shrink-0 flex-col border-r"
    >
      {/* Masthead. Wordmark sits inside the macOS traffic-light row's
          drag region — left-aligned past the lights, vertically centered
          on the 64px masthead so the rust "F" lines up with the active-tab
          accent bar below. */}
      <div className="app-region-drag relative flex h-16 items-center pl-20">
        <div className="font-display text-text-primary flex items-baseline text-[22px] leading-none tracking-tight">
          <span className="text-accent font-bold">F</span>
          <span className="font-medium">orme</span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-2">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map(({ id, label, Icon }) => {
            const isActive = activeTab === id;
            return (
              <li key={id}>
                <button
                  type="button"
                  data-testid={`nav-${id}`}
                  onClick={() => setActiveTab(id)}
                  className={[
                    "group text-title-sm relative flex w-full items-center gap-3 rounded-md px-4 py-2.5",
                    "duration-fast ease-standard transition-colors",
                    isActive
                      ? "text-text-primary"
                      : "text-text-secondary hover:text-text-primary hover:bg-black/[0.04]",
                  ].join(" ")}
                >
                  {/* Active-state left-accent bar per DESIGN.md §9 sidebar spec */}
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="bg-accent absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-r-sm"
                    />
                  )}
                  <Icon
                    size={18}
                    weight="regular"
                    className={
                      isActive ? "text-accent" : "text-text-secondary group-hover:text-text-primary"
                    }
                  />
                  <span>{label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Bottom: stats + Export (filled rust per Pass 1 decision) */}
      <div className="border-border-default border-t px-6 py-4">
        <div className="text-caption text-text-tertiary mb-2">
          {currentIssue
            ? `${currentIssue.articleCount} articles · ${currentIssue.classifiedCount} classifieds`
            : "No issue yet"}
        </div>
        <button
          type="button"
          data-testid="export-button"
          onClick={handleExport}
          disabled={!canExport}
          className={[
            "bg-accent text-title-sm text-text-inverse hover:bg-accent-hover flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 font-semibold transition-colors",
            !canExport ? "opacity-40" : "",
          ].join(" ")}
        >
          {exporting ? "Exporting..." : "Export"}
        </button>
      </div>
    </aside>
  );
}
