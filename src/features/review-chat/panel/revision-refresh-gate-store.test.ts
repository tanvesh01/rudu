import { describe, expect, it } from "bun:test";
import { createRevisionRefreshGateStore } from "./revision-refresh-gate-store";

describe("revision refresh gate store", () => {
  it("starts up to date", () => {
    const store = createRevisionRefreshGateStore();

    expect(store.getState()).toMatchObject({
      mode: "up_to_date",
      revision: null,
      error: null,
    });
  });

  it("detects a newer pull request revision", () => {
    const store = createRevisionRefreshGateStore();

    store.getState().observeRevision({
      activeHeadSha: "old",
      latestHeadSha: "new",
      sessionId: "owner-repo-pr-1",
    });

    expect(store.getState()).toMatchObject({
      mode: "update_available",
      revision: {
        activeHeadSha: "old",
        latestHeadSha: "new",
        sessionId: "owner-repo-pr-1",
      },
      error: null,
    });
  });

  it("blocks observation churn while refreshing the same revision", () => {
    const store = createRevisionRefreshGateStore();

    store.getState().observeRevision({
      activeHeadSha: "old",
      latestHeadSha: "new",
      sessionId: "owner-repo-pr-1",
    });

    expect(store.getState().startRefresh()).toBe(true);

    store.getState().observeRevision({
      activeHeadSha: "old",
      latestHeadSha: "new",
      sessionId: "owner-repo-pr-1",
    });

    expect(store.getState().mode).toBe("refreshing");
  });

  it("moves back to up to date after refresh succeeds", () => {
    const store = createRevisionRefreshGateStore();

    store.getState().observeRevision({
      activeHeadSha: "old",
      latestHeadSha: "new",
      sessionId: "owner-repo-pr-1",
    });
    store.getState().startRefresh();
    store.getState().finishRefresh({
      activeHeadSha: "new",
      sessionId: "owner-repo-pr-1",
    });

    expect(store.getState()).toMatchObject({
      mode: "up_to_date",
      revision: {
        activeHeadSha: "new",
        latestHeadSha: "new",
        sessionId: "owner-repo-pr-1",
      },
      error: null,
    });
  });

  it("keeps the prompt blocked after refresh fails", () => {
    const store = createRevisionRefreshGateStore();

    store.getState().observeRevision({
      activeHeadSha: "old",
      latestHeadSha: "new",
      sessionId: "owner-repo-pr-1",
    });
    store.getState().startRefresh();
    store.getState().failRefresh("Workspace has local changes.");

    expect(store.getState()).toMatchObject({
      mode: "refresh_failed",
      error: "Workspace has local changes.",
    });
  });
});
