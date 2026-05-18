import { create } from "zustand";
import type { RepoSummary } from "../types/github";

export type PullRequestPickerMode = "repo-then-pr" | "pr-only";
export type PullRequestPickerStep = "repo" | "pull-request";

interface PickerWorkflowStore {
  // State
  isPickerOpen: boolean;
  pickerMode: PullRequestPickerMode;
  pickerStep: PullRequestPickerStep;
  pickerRepo: RepoSummary | null;
  debouncedQuery: string;

  // Async workflow flags
  isSavingRepo: boolean;
  isOpeningPullRequestLink: boolean;
  isTrackingPullRequest: boolean;
  manualEntryError: string | null;

  // Actions — nested for stable subscription
  actions: {
    openRepoPicker: () => void;
    openRepoPullRequestPicker: (repo: RepoSummary) => void;
    pickerOpenChanged: (open: boolean) => void;
    pickerStepChanged: (step: PullRequestPickerStep) => void;
    pickerRepoChanged: (repo: RepoSummary | null) => void;
    searchQueryChanged: (query: string) => void;
    pickerStateReset: () => void;
    repoSaveStarted: () => void;
    repoSaveCompleted: () => void;
    pullRequestLinkOpenStarted: () => void;
    pullRequestLinkOpenCompleted: () => void;
    pullRequestTrackingStarted: () => void;
    pullRequestTrackingCompleted: () => void;
    manualEntryFailed: (error: string) => void;
    manualEntryCleared: () => void;
  };
}

const usePickerWorkflowStore = create<PickerWorkflowStore>((set, get) => ({
  isPickerOpen: false,
  pickerMode: "repo-then-pr",
  pickerStep: "repo",
  pickerRepo: null,
  debouncedQuery: "",
  isSavingRepo: false,
  isOpeningPullRequestLink: false,
  isTrackingPullRequest: false,
  manualEntryError: null,

  actions: {
    openRepoPicker() {
      set({
        pickerMode: "repo-then-pr",
        pickerStep: "repo",
        pickerRepo: null,
        isPickerOpen: true,
        manualEntryError: null,
      });
    },

    openRepoPullRequestPicker(repo) {
      set({
        pickerMode: "pr-only",
        pickerStep: "pull-request",
        pickerRepo: repo,
        isPickerOpen: true,
        manualEntryError: null,
      });
    },

    pickerOpenChanged(open) {
      set((state) => {
        if (!open && state.isPickerOpen) {
          return {
            isPickerOpen: false,
            manualEntryError: null,
            pickerStep:
              state.pickerMode === "pr-only" ? "pull-request" : "repo",
            pickerRepo:
              state.pickerMode === "repo-then-pr" ? null : state.pickerRepo,
          };
        }
        return { isPickerOpen: open };
      });
    },

    pickerStepChanged(step) {
      set({ pickerStep: step });
    },

    pickerRepoChanged(repo) {
      set({ pickerRepo: repo });
    },

    searchQueryChanged(query) {
      set({ debouncedQuery: query });
    },

    pickerStateReset() {
      const { pickerMode } = get();
      set({
        pickerStep: pickerMode === "pr-only" ? "pull-request" : "repo",
        pickerRepo: pickerMode === "repo-then-pr" ? null : get().pickerRepo,
        manualEntryError: null,
        debouncedQuery: "",
      });
    },

    repoSaveStarted() {
      set({ isSavingRepo: true });
    },

    repoSaveCompleted() {
      set({ isSavingRepo: false });
    },

    pullRequestLinkOpenStarted() {
      set({ isOpeningPullRequestLink: true });
    },

    pullRequestLinkOpenCompleted() {
      set({ isOpeningPullRequestLink: false });
    },

    pullRequestTrackingStarted() {
      set({ isTrackingPullRequest: true });
    },

    pullRequestTrackingCompleted() {
      set({ isTrackingPullRequest: false });
    },

    manualEntryFailed(error) {
      set({ manualEntryError: error });
    },

    manualEntryCleared() {
      set({ manualEntryError: null });
    },
  },
}));

export { usePickerWorkflowStore };
export type { PickerWorkflowStore };
