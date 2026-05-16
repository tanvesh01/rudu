import { describe, expect, it } from "bun:test";
import type { RemoteReviewSession } from "../types/github";
import {
  getRemoteReviewSessionKey,
  isRemoteReviewSessionStale,
} from "./remote-review";

const revision = {
  repo: "tanvesh/rudu",
  number: 51,
  headSha: "abc123",
};

function makeSession(overrides: Partial<RemoteReviewSession> = {}) {
  return {
    id: "tanvesh-rudu-pr-51",
    repo: "tanvesh/rudu",
    number: 51,
    headSha: "abc123",
    status: "prepared",
    workspacePath: "/tmp/workspace",
    reportPath: "/tmp/report.md",
    createdAt: 1,
    updatedAt: 1,
    lastError: null,
    ...overrides,
  } satisfies RemoteReviewSession;
}

describe("remote review session helpers", () => {
  it("keys sessions by repo and pull request number", () => {
    expect(getRemoteReviewSessionKey(revision)).toBe(
      "tanvesh/rudu#51",
    );
  });

  it("treats a matching session as current", () => {
    expect(isRemoteReviewSessionStale(makeSession(), revision)).toBe(false);
  });

  it("keeps a session current when only the head sha changes", () => {
    expect(
      isRemoteReviewSessionStale(makeSession({ headSha: "old" }), revision),
    ).toBe(false);
  });

  it("treats a different PR number as stale", () => {
    expect(
      isRemoteReviewSessionStale(makeSession({ number: 52 }), revision),
    ).toBe(true);
  });
});
