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

// Settings sub-tab — set by the storage banner's "Manage →" button so the
// Settings screen lands on the right panel (T12 / v0.6).
export type SettingsTab = "profile" | "storage";

export interface NavState {
  activeTab: TabId;
  settingsTab: SettingsTab;
  setActiveTab: (tab: TabId) => void;
  setSettingsTab: (tab: SettingsTab) => void;
}

export const useNavStore = create<NavState>((set) => ({
  activeTab: "issue-board",
  settingsTab: "profile",
  setActiveTab: (tab) => set({ activeTab: tab }),
  setSettingsTab: (tab) => set({ settingsTab: tab }),
}));

// Re-export useShallow so components use it by default, per eng-plan §1
export { useShallow };
