import { describe, expect, it } from "bun:test";
import {
  FOCUS_REFRESH_INTERVAL_MS,
  getSelectedPullRequestDiffKey,
  getSelectedPullRequestIdentityKey,
  getSelectedPullRequestRevision,
  isSelectedRepoRefreshStale,
} from "./useSelectedPullRequestWorkspace";
import type { PullRequestSummary } from "../types/github";

describe("useSelectedPullRequestWorkspace helpers", () => {
  it("builds stable identity and diff keys from selected PR state", () => {
    const summary = {
      number: 42,
      title: "Workspace refactor",
      state: "OPEN",
      isDraft: false,
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
      additions: 25,
      deletions: 9,
      authorLogin: "octocat",
      updatedAt: "2026-05-11T00:00:00Z",
      url: "https://github.com/outerworld/rudu/pull/42",
      headSha: "abc123",
      baseSha: "def456",
    } satisfies PullRequestSummary;

    const selectedPr = { repo: "outerworld/rudu", number: 42 };
    const selectedRevision = getSelectedPullRequestRevision(
      selectedPr,
      summary,
    );

    expect(getSelectedPullRequestIdentityKey(selectedPr)).toBe(
      "outerworld/rudu#42",
    );
    expect(selectedRevision).toEqual({
      repo: "outerworld/rudu",
      number: 42,
      headSha: "abc123",
    });
    expect(getSelectedPullRequestDiffKey(selectedRevision)).toBe(
      "outerworld/rudu#42@abc123",
    );
  });

  it("returns null-derived values when the selected summary is unavailable", () => {
    expect(
      getSelectedPullRequestRevision(
        { repo: "outerworld/rudu", number: 42 },
        null,
      ),
    ).toBeNull();
    expect(getSelectedPullRequestIdentityKey(null)).toBeNull();
    expect(getSelectedPullRequestDiffKey(null)).toBeNull();
  });

  it("treats selected repo refreshes as stale only after the focus interval", () => {
    const now = 200_000;
    const freshAt = now - (FOCUS_REFRESH_INTERVAL_MS - 1);
    const staleAt = now - FOCUS_REFRESH_INTERVAL_MS;

    expect(isSelectedRepoRefreshStale(freshAt, now)).toBe(false);
    expect(isSelectedRepoRefreshStale(staleAt, now)).toBe(true);
  });
});
