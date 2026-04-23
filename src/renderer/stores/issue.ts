import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { invoke } from "../ipc/client.js";
import type {
  IssueSummary,
  ArticleSummary,
  ClassifiedSummary,
  AdSummary,
  PublisherProfile,
} from "@shared/ipc-contracts/channels.js";

interface IssueState {
  currentIssue: IssueSummary | null;
  issues: IssueSummary[];
  articles: ArticleSummary[];
  classifieds: ClassifiedSummary[];
  ads: AdSummary[];
  profile: PublisherProfile | null;

  // Actions
  refreshIssues: () => Promise<void>;
  setCurrentIssue: (issue: IssueSummary) => void;
  refreshArticles: () => Promise<void>;
  refreshClassifieds: () => Promise<void>;
  refreshAds: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshAll: () => Promise<void>;

  // v0.6 T13: optimistic local reordering. Renderer applies the new order
  // immediately so dragging feels snappy; the IPC persist + a refresh
  // follow asynchronously via the screen.
  setArticles: (articles: ArticleSummary[]) => void;
  setClassifieds: (classifieds: ClassifiedSummary[]) => void;
  setAds: (ads: AdSummary[]) => void;
}

export const useIssueStore = create<IssueState>((set, get) => ({
  currentIssue: null,
  issues: [],
  articles: [],
  classifieds: [],
  ads: [],
  profile: null,

  async refreshIssues() {
    const issues = await invoke("issue:list", null);
    set({ issues });
    const current = get().currentIssue;
    // If current was deleted or not set yet, pick the most recent
    if (!current && issues[0]) {
      set({ currentIssue: issues[0] });
    } else if (current) {
      const updated = issues.find((i) => i.id === current.id);
      if (updated) set({ currentIssue: updated });
    }
  },

  setCurrentIssue(issue) {
    set({ currentIssue: issue });
  },

  async refreshArticles() {
    const issueId = get().currentIssue?.id;
    if (!issueId) {
      set({ articles: [] });
      return;
    }
    const articles = await invoke("article:list", { issueId });
    set({ articles });
  },

  async refreshClassifieds() {
    const issueId = get().currentIssue?.id ?? null;
    const classifieds = await invoke("classified:list", { issueId });
    set({ classifieds });
  },

  async refreshAds() {
    const issueId = get().currentIssue?.id ?? null;
    const ads = await invoke("ad:list", { issueId });
    set({ ads });
  },

  async refreshProfile() {
    const profile = await invoke("publisher:get", null);
    set({ profile });
  },

  async refreshAll() {
    await get().refreshIssues();
    await Promise.all([
      get().refreshArticles(),
      get().refreshClassifieds(),
      get().refreshAds(),
      get().refreshProfile(),
    ]);
  },

  setArticles(articles) {
    set({ articles });
  },
  setClassifieds(classifieds) {
    set({ classifieds });
  },
  setAds(ads) {
    set({ ads });
  },
}));

export { useShallow };
