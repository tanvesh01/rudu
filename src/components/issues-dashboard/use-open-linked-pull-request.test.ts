import { describe, expect, it } from "bun:test";
import {
  createOpenLinkedPullRequestHandler,
  type OpenLinkedPullRequestDeps,
} from "./use-open-linked-pull-request";
import type {
  IssueLinkedPullRequest,
  PullRequestSummary,
  RepoSummary,
} from "@/types/github";

function pullRequestSummary(number = 42): PullRequestSummary {
  return {
    number,
    title: `PR ${number}`,
    state: "OPEN",
    isDraft: false,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    additions: 1,
    deletions: 2,
    authorLogin: "octocat",
    updatedAt: "2026-05-16T00:00:00Z",
    url: `https://github.com/owner/repo/pull/${number}`,
    headSha: "abc123",
    baseSha: "def456",
  };
}

function linkedPullRequest(number = 42): IssueLinkedPullRequest {
  return {
    number,
    title: `PR ${number}`,
    repo: "owner/repo",
    url: `https://github.com/owner/repo/pull/${number}`,
  };
}

function repoSummary(): RepoSummary {
  return {
    name: "repo",
    nameWithOwner: "owner/repo",
    description: null,
    isPrivate: false,
  };
}

function createToastRecorder() {
  const calls: Array<{ fn: "add" | "close"; value: unknown }> = [];
  const manager: NonNullable<OpenLinkedPullRequestDeps["toastManager"]> = {
    add(value) {
      calls.push({ fn: "add", value });
    },
    close(id) {
      calls.push({ fn: "close", value: id });
    },
  };

  return {
    calls,
    manager,
  };
}

describe("createOpenLinkedPullRequestHandler", () => {
  it("opens an already tracked linked PR in Rudu", async () => {
    const navigations: unknown[] = [];
    const toast = createToastRecorder();
    const handler = createOpenLinkedPullRequestHandler({
      delayFn: async () => undefined,
      navigate: (value) => {
        navigations.push(value);
      },
      queryClient: {
        fetchQuery: async () => [pullRequestSummary(42)],
        setQueryData: () => {
          throw new Error("tracked PR should not update cache");
        },
      },
      toastManager: toast.manager,
    });

    await handler(linkedPullRequest(42));

    expect(navigations).toEqual([
      {
        params: { owner: "owner", repo: "repo", number: "42" },
        to: "/repos/$owner/$repo/pulls/$number",
      },
    ]);
    expect(toast.calls.some((call) => call.fn === "add")).toBe(true);
    expect(toast.calls.at(-1)).toEqual({
      fn: "close",
      value: "open-linked-pull-request",
    });
  });

  it("tracks an untracked linked PR before navigation", async () => {
    const navigations: unknown[] = [];
    const savedRepo = repoSummary();
    const trackedPullRequest = pullRequestSummary(42);
    const cacheWrites: unknown[] = [];
    const toast = createToastRecorder();
    const handler = createOpenLinkedPullRequestHandler({
      delayFn: async () => undefined,
      getPullRequestSummaryFn: async () => trackedPullRequest,
      navigate: (value) => {
        navigations.push(value);
      },
      queryClient: {
        fetchQuery: async () => [],
        setQueryData: (queryKey, updater) => {
          cacheWrites.push({ queryKey, value: updater(undefined) });
        },
      },
      saveRepoFn: async () => savedRepo,
      toastManager: toast.manager,
      trackPullRequestFn: async () => trackedPullRequest,
      validateRepoFn: async () => savedRepo,
    });

    await handler(linkedPullRequest(42));

    expect(cacheWrites).toHaveLength(2);
    expect(navigations).toHaveLength(1);
    expect(navigations[0]).toEqual({
      params: { owner: "owner", repo: "repo", number: "42" },
      to: "/repos/$owner/$repo/pulls/$number",
    });
  });

  it("clears loading and does not navigate when auto-track fails", async () => {
    const navigations: unknown[] = [];
    const toast = createToastRecorder();
    const handler = createOpenLinkedPullRequestHandler({
      delayFn: async () => undefined,
      navigate: (value) => {
        navigations.push(value);
      },
      queryClient: {
        fetchQuery: async () => [],
        setQueryData: () => undefined,
      },
      toastManager: toast.manager,
      validateRepoFn: async () => {
        throw new Error("repo unavailable");
      },
    });

    await handler(linkedPullRequest(42));

    expect(navigations).toEqual([]);
    expect(toast.calls).toContainEqual({
      fn: "close",
      value: "open-linked-pull-request",
    });
    expect(
      toast.calls.some(
        (call) =>
          call.fn === "add" &&
          typeof call.value === "object" &&
          call.value !== null &&
          "title" in call.value &&
          call.value.title === "Could not open linked PR",
      ),
    ).toBe(true);
  });
});
