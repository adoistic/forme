import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

// Nav state. Follows docs/eng-plan.md §1 — Zustand with useShallow selectors.
// The 8 tabs are locked per CEO review Section 11 decision (8-tab IA).
export type TabId =
  | "issue-board"
  | "articles"
  | "classifieds"
  | "ads"
  | "images"
  | "templates"
  | "history"
  | "settings";

export interface NavState {
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
}

export const useNavStore = create<NavState>((set) => ({
  activeTab: "issue-board",
  setActiveTab: (tab) => set({ activeTab: tab }),
}));

// Re-export useShallow so components use it by default, per eng-plan §1
export { useShallow };
