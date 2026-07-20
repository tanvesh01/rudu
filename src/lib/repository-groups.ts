import type { RepoSummary } from "../types/github";
import type { LocalCheckout } from "../types/local-checkouts";

type RepositoryGroup = {
  key: string;
  label: string;
  githubRepo: RepoSummary | null;
  localCheckouts: LocalCheckout[];
};

function buildRepositoryGroups(
  repos: RepoSummary[],
  localCheckouts: LocalCheckout[],
): RepositoryGroup[] {
  const groups = new Map<string, RepositoryGroup>();
  const groupsByGithubIdentity = new Map<string, RepositoryGroup>();

  for (const repo of repos) {
    const group = {
      key: repo.nameWithOwner,
      label: repo.nameWithOwner,
      githubRepo: repo,
      localCheckouts: [],
    } satisfies RepositoryGroup;
    groups.set(repo.nameWithOwner, group);
    groupsByGithubIdentity.set(repo.nameWithOwner.toLocaleLowerCase(), group);
  }

  for (const checkout of localCheckouts) {
    const existing = checkout.githubRepo
      ? groupsByGithubIdentity.get(checkout.githubRepo.toLocaleLowerCase())
      : groups.get(checkout.repositoryKey);
    if (existing) {
      existing.localCheckouts.push(checkout);
      continue;
    }

    const group = {
      key: checkout.repositoryKey,
      label: checkout.githubRepo ?? checkout.folderName,
      githubRepo: null,
      localCheckouts: [checkout],
    } satisfies RepositoryGroup;
    groups.set(checkout.repositoryKey, group);
    if (checkout.githubRepo) {
      groupsByGithubIdentity.set(checkout.githubRepo.toLocaleLowerCase(), group);
    }
  }

  return Array.from(groups.values());
}

export { buildRepositoryGroups };
export type { RepositoryGroup };
