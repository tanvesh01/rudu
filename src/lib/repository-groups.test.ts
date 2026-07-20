import { describe, expect, it } from "bun:test";
import type { RepoSummary } from "../types/github";
import type { LocalCheckout } from "../types/local-checkouts";
import { buildRepositoryGroups } from "./repository-groups";

const githubRepo = {
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

function checkout(
  id: string,
  repositoryKey: string,
  githubRepoName: string | null,
): LocalCheckout {
  return {
    id,
    path: `/work/${id}`,
    repositoryKey,
    folderName: id,
    branch: "main",
    githubRepo: githubRepoName,
    available: true,
  };
}

describe("repository groups", () => {
  it("combines matching local checkouts with GitHub repositories and keeps local-only groups", () => {
    const groups = buildRepositoryGroups(
      [githubRepo],
      [
        checkout("rudu-main", "outerworld/rudu", "outerworld/rudu"),
        checkout("rudu-feature", "outerworld/rudu", "outerworld/rudu"),
        checkout("scratch", "local:abc", null),
      ],
    );

    expect(groups).toEqual([
      {
        key: "outerworld/rudu",
        label: "outerworld/rudu",
        githubRepo,
        localCheckouts: [
          checkout("rudu-main", "outerworld/rudu", "outerworld/rudu"),
          checkout("rudu-feature", "outerworld/rudu", "outerworld/rudu"),
        ],
      },
      {
        key: "local:abc",
        label: "scratch",
        githubRepo: null,
        localCheckouts: [checkout("scratch", "local:abc", null)],
      },
    ]);
  });

  it("matches GitHub identities without case sensitivity", () => {
    const localCheckout = checkout(
      "rudu-case-variant",
      "Outerworld/Rudu",
      "Outerworld/Rudu",
    );

    const groups = buildRepositoryGroups([githubRepo], [localCheckout]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.localCheckouts).toEqual([localCheckout]);
  });

  it("keeps multiple local checkouts under one local-only GitHub group", () => {
    const first = checkout(
      "rudu-main",
      "outerworld/rudu",
      "outerworld/rudu",
    );
    const second = checkout(
      "rudu-feature",
      "Outerworld/Rudu",
      "Outerworld/Rudu",
    );

    const groups = buildRepositoryGroups([], [first, second]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.localCheckouts).toEqual([first, second]);
  });
});
