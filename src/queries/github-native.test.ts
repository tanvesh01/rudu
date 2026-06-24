import { describe, expect, it } from "bun:test";
import { createGithubNativeCommands, type InvokeFn } from "./github-native";
import type { PullRequestSummary, RepoSummary } from "../types/github";

function createRecordingInvoke(responses: unknown[] = []) {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const invokeFn: InvokeFn = async <T>(
    command: string,
    args?: Record<string, unknown>,
  ) => {
    calls.push({ command, args });
    return responses.shift() as T;
  };

  return { calls, invokeFn };
}

describe("createGithubNativeCommands", () => {
  it("maps repo commands to Tauri command names and payloads", async () => {
    const repo = {
      name: "rudu",
      nameWithOwner: "outerworld/rudu",
      description: null,
      isPrivate: true,
      languages: [],
      stargazerCount: null,
      forkCount: null,
      issueCount: null,
      pullRequestCount: null,
      contributorCount: null,
    } satisfies RepoSummary;
    const { calls, invokeFn } = createRecordingInvoke([
      { repos: [repo], warning: null },
      { repos: [repo], warning: null },
      repo,
      repo,
    ]);
    const commands = createGithubNativeCommands(invokeFn);

    await expect(commands.listInitialRepos(20)).resolves.toEqual({
      repos: [repo],
      warning: null,
    });
    await expect(commands.searchRepos("rudu", 20)).resolves.toEqual({
      repos: [repo],
      warning: null,
    });
    await commands.saveRepo(repo);
    await commands.validateRepo("outerworld/rudu");

    expect(calls).toEqual([
      { command: "list_initial_repos", args: { limit: 20 } },
      { command: "search_repos", args: { query: "rudu", limit: 20 } },
      { command: "save_repo", args: { repo } },
      { command: "validate_repo", args: { repo: "outerworld/rudu" } },
    ]);
  });

  it("normalizes viewer login responses", async () => {
    const { invokeFn } = createRecordingInvoke(["tanvesh"]);
    const commands = createGithubNativeCommands(invokeFn);

    await expect(commands.getViewerLogin()).resolves.toEqual({
      login: "tanvesh",
    });
  });

  it("maps pull request commands without changing payload keys", async () => {
    const pullRequest = {
      number: 42,
      title: "Refactor native seam",
      state: "OPEN",
      isDraft: false,
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
      additions: 10,
      deletions: 2,
      authorLogin: "octocat",
      updatedAt: "2026-05-11T00:00:00Z",
      url: "https://github.com/outerworld/rudu/pull/42",
      headSha: "abc123",
      baseSha: "def456",
    } satisfies PullRequestSummary;
    const { calls, invokeFn } = createRecordingInvoke([pullRequest, undefined]);
    const commands = createGithubNativeCommands(invokeFn);

    await commands.trackPullRequest("outerworld/rudu", pullRequest);
    await commands.removeTrackedPullRequest("outerworld/rudu", 42);

    expect(calls).toEqual([
      {
        command: "track_pull_request",
        args: { repo: "outerworld/rudu", pullRequest },
      },
      {
        command: "remove_tracked_pull_request",
        args: { repo: "outerworld/rudu", number: 42 },
      },
    ]);
  });

  it("maps review comment commands with GitHub GraphQL payload casing", async () => {
    const { calls, invokeFn } = createRecordingInvoke([undefined]);
    const commands = createGithubNativeCommands(invokeFn);

    await commands.createPullRequestReviewComment({
      repo: "outerworld/rudu",
      number: 42,
      body: "Looks good",
      path: "src/App.tsx",
      line: 12,
      side: "RIGHT",
      startLine: null,
      startSide: null,
      subjectType: "line",
    });

    expect(calls).toEqual([
      {
        command: "create_pull_request_review_comment",
        args: {
          repo: "outerworld/rudu",
          number: 42,
          body: "Looks good",
          path: "src/App.tsx",
          line: 12,
          side: "RIGHT",
          startLine: null,
          startSide: null,
          subjectType: "line",
        },
      },
    ]);
  });
});
