import { describe, expect, it } from "bun:test";
import type { ReviewSession } from "../types/github";
import {
  getReviewSessionKey,
  isReviewSessionStale,
} from "./review-session";

const revision = {
  repo: "tanvesh/rudu",
  number: 51,
  headSha: "abc123",
};

function makeSession(overrides: Partial<ReviewSession> = {}) {
  return {
    id: "tanvesh-rudu-pr-51",
    repo: "tanvesh/rudu",
    number: 51,
    headSha: "abc123",
    status: "prepared",
    workspacePath: "/tmp/workspace",
    agentSessionId: null,
    agentContextHeadSha: null,
    createdAt: 1,
    updatedAt: 1,
    lastError: null,
    ...overrides,
  } satisfies ReviewSession;
}

describe("Rudu session helpers", () => {
  it("keys sessions by repo and pull request number", () => {
    expect(getReviewSessionKey(revision)).toBe(
      "tanvesh/rudu#51",
    );
  });

  it("treats a matching session as current", () => {
    expect(isReviewSessionStale(makeSession(), revision)).toBe(false);
  });

  it("keeps a session current when only the head sha changes", () => {
    expect(
      isReviewSessionStale(makeSession({ headSha: "old" }), revision),
    ).toBe(false);
  });

  it("treats a different PR number as stale", () => {
    expect(
      isReviewSessionStale(makeSession({ number: 52 }), revision),
    ).toBe(true);
  });
});
