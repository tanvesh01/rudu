import { create } from "zustand";
import type { RepoSummary } from "../types/github";

export type PullRequestPickerMode = "repo-then-pr" | "pr-only";
export type PullRequestPickerStep = "repo" | "pull-request";

interface PickerWorkflowStore {
  // Picker UI state
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

  // Actions
  openRepoPicker: () => void;
  openRepoPullRequestPicker: (repo: RepoSummary) => void;
  setIsPickerOpen: (open: boolean) => void;
  setPickerStep: (step: PullRequestPickerStep) => void;
  setPickerRepo: (repo: RepoSummary | null) => void;
  setDebouncedQuery: (query: string) => void;
  resetPickerState: () => void;
  setIsSavingRepo: (isSaving: boolean) => void;
  setIsOpeningPullRequestLink: (isOpening: boolean) => void;
  setIsTrackingPullRequest: (isTracking: boolean) => void;
  setManualEntryError: (error: string | null) => void;
  clearManualEntryError: () => void;
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

  setIsPickerOpen(open) {
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

  setPickerStep(step) {
    set({ pickerStep: step });
  },

  setPickerRepo(repo) {
    set({ pickerRepo: repo });
  },

  setDebouncedQuery(query) {
    set({ debouncedQuery: query });
  },

  resetPickerState() {
    const { pickerMode } = get();
    set({
      pickerStep: pickerMode === "pr-only" ? "pull-request" : "repo",
      pickerRepo: pickerMode === "repo-then-pr" ? null : get().pickerRepo,
      manualEntryError: null,
      debouncedQuery: "",
    });
  },

  setIsSavingRepo(isSaving) {
    set({ isSavingRepo: isSaving });
  },

  setIsOpeningPullRequestLink(isOpening) {
    set({ isOpeningPullRequestLink: isOpening });
  },

  setIsTrackingPullRequest(isTracking) {
    set({ isTrackingPullRequest: isTracking });
  },

  setManualEntryError(error) {
    set({ manualEntryError: error });
  },

  clearManualEntryError() {
    set({ manualEntryError: null });
  },
}));

export { usePickerWorkflowStore };
export type { PickerWorkflowStore };
