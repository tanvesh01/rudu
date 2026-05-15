import { describe, expect, it } from "bun:test";
import type { RemoteReviewSession } from "../types/github";
import {
  getRemoteReviewSessionKey,
  isRemoteReviewSessionStale,
  shouldHydrateRemoteReviewSession,
} from "./remote-review";

const revision = {
  repo: "tanvesh/rudu",
  number: 51,
  headSha: "abc123",
};

function makeSession(overrides: Partial<RemoteReviewSession> = {}) {
  return {
    id: "tanvesh-rudu-pr-51-abc123",
    repo: "tanvesh/rudu",
    number: 51,
    headSha: "abc123",
    status: "prepared",
    fileContext: null,
    reportPath: "/tmp/report.md",
    createdAt: 1,
    updatedAt: 1,
    lastError: null,
    ...overrides,
  } satisfies RemoteReviewSession;
}

describe("remote review session helpers", () => {
  it("keys sessions by repo, pull request number, and head sha", () => {
    expect(getRemoteReviewSessionKey(revision)).toBe(
      "tanvesh/rudu#51@abc123",
    );
  });

  it("treats a matching session as current", () => {
    expect(isRemoteReviewSessionStale(makeSession(), revision)).toBe(false);
  });

  it("treats a different head sha as stale", () => {
    expect(
      isRemoteReviewSessionStale(makeSession({ headSha: "old" }), revision),
    ).toBe(true);
  });

  it("hydrates prepared sessions even when the Worker already returned indexed file metadata", () => {
    expect(
      shouldHydrateRemoteReviewSession(
        makeSession({
          fileContext: {
            provider: "github",
            indexedAt: 1,
            fileCount: 42,
            expiresAt: 2,
          },
        }),
      ),
    ).toBe(true);
  });

  it("does not rehydrate sessions that already reached the indexed or launched state", () => {
    expect(
      shouldHydrateRemoteReviewSession(makeSession({ status: "indexed" })),
    ).toBe(false);
    expect(
      shouldHydrateRemoteReviewSession(makeSession({ status: "launched" })),
    ).toBe(false);
  });
});
