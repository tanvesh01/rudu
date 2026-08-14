type PullRequestListScope = "all" | "inbox";

type PullRequestListRouteSearch = {
  repo?: string;
  scope?: "all";
};

function validatePullRequestListRouteSearch(
  search: Record<string, unknown>,
): PullRequestListRouteSearch {
  const repo =
    typeof search.repo === "string" && search.repo ? search.repo : undefined;

  return {
    ...(repo ? { repo } : {}),
    ...(repo && search.scope === "all" ? { scope: "all" as const } : {}),
  };
}

export { validatePullRequestListRouteSearch };
export type { PullRequestListRouteSearch, PullRequestListScope };
