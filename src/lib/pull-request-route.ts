import type { SelectedPullRequestRef } from "../types/github";

const PULL_REQUEST_ROUTE = "/repos/$owner/$repo/pulls/$number" as const;
const DEFAULT_PULL_REQUEST_PANEL = "changed-files";

type PullRequestPanel = "changed-files" | "pull-request" | "review-chat";

type PullRequestRouteParams = {
  owner: string;
  repo: string;
  number: string;
};

type PullRequestRouteSearch = {
  panel?: PullRequestPanel;
};

function parsePullRequestNumber(value: string) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function parsePullRequestPanel(value: unknown): PullRequestPanel {
  if (value === "pull-request" || value === "review-chat") {
    return value;
  }

  return DEFAULT_PULL_REQUEST_PANEL;
}

function getPullRequestPanelSearch(panel: PullRequestPanel) {
  return panel === DEFAULT_PULL_REQUEST_PANEL ? {} : { panel };
}

function validatePullRequestRouteSearch(
  search: Record<string, unknown>,
): PullRequestRouteSearch {
  const panel = parsePullRequestPanel(search.panel);
  return getPullRequestPanelSearch(panel);
}

function getPullRequestIdentityKey(
  pullRequest: SelectedPullRequestRef | null,
) {
  return pullRequest ? `${pullRequest.repo}#${pullRequest.number}` : null;
}

function getPullRequestRouteParams(
  repo: string,
  number: number,
): PullRequestRouteParams | null {
  const [owner, repoName, ...rest] = repo.split("/");
  if (!owner || !repoName || rest.length > 0) {
    return null;
  }

  return {
    owner,
    repo: repoName,
    number: String(number),
  };
}

function getSelectedPullRequestFromRouteParams(
  params: PullRequestRouteParams,
): SelectedPullRequestRef | null {
  const number = parsePullRequestNumber(params.number);
  if (!params.owner || !params.repo || number === null) {
    return null;
  }

  return {
    repo: `${params.owner}/${params.repo}`,
    number,
  };
}

function getSelectedPullRequestFromPathname(pathname: string) {
  const match = pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/pulls\/([^/]+)$/);
  if (!match) {
    return null;
  }

  const [, owner, repo, number] = match;
  return getSelectedPullRequestFromRouteParams({
    owner: decodeURIComponent(owner),
    repo: decodeURIComponent(repo),
    number: decodeURIComponent(number),
  });
}

function parsePullRequestLink(input: string): SelectedPullRequestRef | null {
  const trimmedInput = input.trim();
  if (!trimmedInput) return null;

  const candidateUrl =
    trimmedInput.startsWith("http://") || trimmedInput.startsWith("https://")
      ? trimmedInput
      : `https://${trimmedInput}`;

  try {
    const url = new URL(candidateUrl);
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
      return null;
    }

    const [owner, repo, resource, numberSegment] = url.pathname
      .split("/")
      .filter(Boolean);
    const number = numberSegment
      ? parsePullRequestNumber(numberSegment)
      : null;

    if (!owner || !repo || resource !== "pull" || number === null) {
      return null;
    }

    return {
      repo: `${owner}/${repo}`,
      number,
    };
  } catch {
    return null;
  }
}

export {
  DEFAULT_PULL_REQUEST_PANEL,
  PULL_REQUEST_ROUTE,
  getPullRequestPanelSearch,
  getPullRequestIdentityKey,
  getPullRequestRouteParams,
  getSelectedPullRequestFromPathname,
  getSelectedPullRequestFromRouteParams,
  parsePullRequestPanel,
  parsePullRequestLink,
  parsePullRequestNumber,
  validatePullRequestRouteSearch,
};
export type { PullRequestPanel, PullRequestRouteParams, PullRequestRouteSearch };
