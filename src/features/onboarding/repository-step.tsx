import { useEffect, useMemo, useState } from "react";
import type { ComponentType, SVGProps } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightIcon, CheckCircleIcon } from "@heroicons/react/20/solid";
import OcticonIssueOpened24 from "../../assets/icons/OcticonIssueOpened24";
import TablerArrowFork from "../../assets/icons/TablerArrowFork";
import TablerGitPullRequest from "../../assets/icons/TablerGitPullRequest";
import TablerStars from "../../assets/icons/TablerStars";
import {
  githubKeys,
  initialReposQueryOptions,
  pullRequestListQueryOptions,
  searchReposQueryOptions,
  trackedPullRequestListQueryOptions,
} from "../../queries/github";
import { saveRepo, trackPullRequest } from "../../queries/github-native";
import { getOwnerAvatarUrl, getOwnerLogin } from "../../lib/github-owner";
import { getErrorMessage } from "../../lib/get-error-message";
import { DotmSquare15 } from "../../components/ui/dotm-square-15";
import { FileTreeIcon } from "../../components/ui/file-tree-icon";
import { TrackPullRequestModal } from "../../components/ui/track-pull-request-modal";
import type {
  PullRequestSummary,
  RepoLanguage,
  RepoSummary,
  SelectedPullRequestRef,
} from "../../types/github";
import { primaryOnboardingButtonClassName } from "./button-styles";
import type { OnboardingCompleteHandler } from "./types";

const ONBOARDING_INITIAL_REPO_LIMIT = 6;
const ONBOARDING_SEARCH_REPO_LIMIT = 8;
const REPO_SEARCH_DEBOUNCE_MS = 300;

type RepositoryStepProps = {
  initialSavedRepos: RepoSummary[];
  onComplete: OnboardingCompleteHandler;
};

function RepositoryStep({
  initialSavedRepos,
  onComplete,
}: RepositoryStepProps) {
  const queryClient = useQueryClient();
  const [selectedRepos, setSelectedRepos] =
    useState<RepoSummary[]>(initialSavedRepos);
  const [modalRepo, setModalRepo] = useState<RepoSummary | null>(null);
  const [savingRepoName, setSavingRepoName] = useState<string | null>(null);
  const [isTrackingPullRequest, setIsTrackingPullRequest] = useState(false);
  const [firstTrackedPullRequest, setFirstTrackedPullRequest] =
    useState<SelectedPullRequestRef | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repoSearchInput, setRepoSearchInput] = useState("");
  const [debouncedRepoSearch, setDebouncedRepoSearch] = useState("");

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedRepoSearch(repoSearchInput);
    }, REPO_SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [repoSearchInput]);

  const repoDiscoveryQuery = useOnboardingRepoDiscovery(debouncedRepoSearch);
  const modalRepoName = modalRepo?.nameWithOwner ?? null;
  const pullRequestQuery = useQuery({
    ...pullRequestListQueryOptions(modalRepoName ?? "__idle__"),
    enabled: modalRepoName !== null,
  });

  const selectedRepoNames = useMemo(
    () => new Set(selectedRepos.map((repo) => repo.nameWithOwner)),
    [selectedRepos],
  );
  const trackedPullRequestQueries = useQueries({
    queries: selectedRepos.map((repo) =>
      trackedPullRequestListQueryOptions(repo.nameWithOwner),
    ),
  });
  const trackedPullRequestKeys = useMemo(() => {
    const keys = new Set<string>();

    selectedRepos.forEach((repo, index) => {
      const pullRequests = trackedPullRequestQueries[index]?.data ?? [];

      for (const pullRequest of pullRequests) {
        keys.add(getPullRequestKey(repo.nameWithOwner, pullRequest.number));
      }
    });

    return keys;
  }, [selectedRepos, trackedPullRequestQueries]);
  const trackedPullRequestCountsByRepo = useMemo(() => {
    const counts = new Map<string, number>();

    selectedRepos.forEach((repo, index) => {
      counts.set(
        repo.nameWithOwner,
        trackedPullRequestQueries[index]?.data?.length ?? 0,
      );
    });

    return counts;
  }, [selectedRepos, trackedPullRequestQueries]);
  const addablePullRequests = useMemo(
    () =>
      recentPullRequests(pullRequestQuery.data ?? []).filter(
        (pullRequest) =>
          modalRepoName !== null &&
          !trackedPullRequestKeys.has(
            getPullRequestKey(modalRepoName, pullRequest.number),
          ),
      ),
    [modalRepoName, pullRequestQuery.data, trackedPullRequestKeys],
  );

  const isRepoSearchDebouncing =
    repoSearchInput.trim() !== debouncedRepoSearch.trim();
  const repos = isRepoSearchDebouncing
    ? []
    : (repoDiscoveryQuery.data?.repos ?? []);
  const repoDiscoveryError = isRepoSearchDebouncing
    ? null
    : repoDiscoveryQuery.error;
  const isRepoDiscoveryPending =
    isRepoSearchDebouncing || repoDiscoveryQuery.isPending;
  const isSearchingRepos = repoSearchInput.trim().length > 0;
  const canContinue = selectedRepos.length > 0 && !savingRepoName;
  const trackedPrCount = trackedPullRequestKeys.size;

  async function handleSelectRepo(repo: RepoSummary) {
    setError(null);
    setSavingRepoName(repo.nameWithOwner);

    try {
      const savedRepo = selectedRepoNames.has(repo.nameWithOwner)
        ? repo
        : await saveRepo(repo);

      setSelectedRepos((current) => upsertRepo(current, savedRepo));
      queryClient.setQueryData<RepoSummary[]>(
        githubKeys.savedRepos(),
        (current) => upsertRepo(current, savedRepo),
      );
      setModalRepo(savedRepo);
    } catch (saveError) {
      setError(getErrorMessage(saveError) || "Couldn't save repository.");
    } finally {
      setSavingRepoName(null);
    }
  }

  async function handlePickPullRequest(pullRequest: PullRequestSummary) {
    if (!modalRepoName) return;

    setError(null);
    setIsTrackingPullRequest(true);

    try {
      const trackedPullRequest = await trackPullRequest(
        modalRepoName,
        pullRequest,
      );
      setFirstTrackedPullRequest((current) => {
        if (current) return current;
        return {
          repo: modalRepoName,
          number: trackedPullRequest.number,
        };
      });
      queryClient.setQueryData<PullRequestSummary[]>(
        githubKeys.trackedPullRequestList(modalRepoName),
        (current) => upsertPullRequest(current, trackedPullRequest),
      );
      setModalRepo(null);
    } catch (trackError) {
      setError(getErrorMessage(trackError) || "Couldn't track pull request.");
    } finally {
      setIsTrackingPullRequest(false);
    }
  }

  function handleContinue() {
    if (!canContinue) return;
    onComplete(firstTrackedPullRequest);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas p-8 text-ink-900">
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col">
        <div className="min-h-0 flex-1">
          <h1 className="text-2xl font-semibold">Choose repositories</h1>
          <p className="mt-2 text-sm text-ink-500">
            Select a repository to add it to Rudu, then choose pull requests
            from the picker.
          </p>

          <input
            className="mt-6 h-10 w-1/2 rounded-md border border-ink-200 bg-surface px-3 text-sm text-ink-900 outline-none transition placeholder:text-ink-500 focus:border-ink-400"
            onChange={(event) => setRepoSearchInput(event.target.value)}
            placeholder="Search repositories by owner or name"
            type="search"
            value={repoSearchInput}
          />

          <RepositoryCardList
            error={repoDiscoveryError}
            isPending={isRepoDiscoveryPending}
            isSearching={isSearchingRepos}
            repos={repos}
            savingRepoName={savingRepoName}
            trackedPullRequestCountsByRepo={trackedPullRequestCountsByRepo}
            selectedRepoNames={selectedRepoNames}
            onSelectRepo={(repo) => void handleSelectRepo(repo)}
          />
        </div>

        {error ? <p className="mt-3 text-sm text-danger-600">{error}</p> : null}

        <div className="mt-4 flex items-center justify-between border-t border-ink-100 pt-4">
          <p className="text-sm text-ink-500">
            {selectedRepos.length} repos selected
            {trackedPrCount > 0 ? `, ${trackedPrCount} PRs added` : ""}
          </p>
          <button
            className={primaryOnboardingButtonClassName}
            disabled={!canContinue}
            onClick={handleContinue}
            type="button"
          >
            Continue
            <ArrowRightIcon aria-hidden="true" className="size-4" />
          </button>
        </div>
      </div>

      <TrackPullRequestModal
        availableReposError={null}
        availableReposWarning={null}
        filteredRepos={[]}
        isLoadingPullRequests={pullRequestQuery.isPending}
        isLoadingRepos={false}
        isSubmittingRepo={false}
        isTrackingPullRequest={isTrackingPullRequest}
        manualRepoError={null}
        mode="pr-only"
        onBack={() => setModalRepo(null)}
        onOpenChange={(open) => {
          if (!open) setModalRepo(null);
        }}
        onPickPullRequest={(pullRequest) =>
          void handlePickPullRequest(pullRequest)
        }
        onPickRepo={() => undefined}
        onSearchChange={() => undefined}
        onSubmitManualRepo={() => undefined}
        open={modalRepo !== null}
        pullRequests={addablePullRequests}
        pullRequestsError={getErrorMessage(pullRequestQuery.error)}
        selectedRepo={modalRepo}
        step="pull-request"
      />
    </div>
  );
}

type RepositoryCardListProps = {
  error: unknown;
  isPending: boolean;
  isSearching: boolean;
  onSelectRepo: (repo: RepoSummary) => void;
  repos: RepoSummary[];
  savingRepoName: string | null;
  selectedRepoNames: Set<string>;
  trackedPullRequestCountsByRepo: Map<string, number>;
};

function RepositoryCardList({
  error,
  isPending,
  isSearching,
  onSelectRepo,
  repos,
  savingRepoName,
  selectedRepoNames,
  trackedPullRequestCountsByRepo,
}: RepositoryCardListProps) {
  return (
    <section className="mt-6 min-h-0">
      <div className="grid max-h-[56vh] grid-cols-2 gap-3 overflow-y-auto pr-1">
        {isPending ? (
          <p className="col-span-2 flex w-full items-center justify-center gap-2 py-6 text-sm text-ink-500">
            <DotmSquare15 dotSize={2.4} size={18} />
            {isSearching
              ? "Searching repositories..."
              : "Loading repositories..."}
          </p>
        ) : null}
        {error ? (
          <p className="col-span-2 rounded-md border border-danger-200 bg-surface p-4 text-sm text-danger-600">
            {getErrorMessage(error)}
          </p>
        ) : null}
        {!isPending && !error && repos.length === 0 ? (
          <p className="col-span-2 rounded-md border border-ink-200 bg-surface p-4 text-sm text-ink-500">
            No repositories found.
          </p>
        ) : null}
        {repos.map((repo) => {
          const isSelected = selectedRepoNames.has(repo.nameWithOwner);
          const isSaving = savingRepoName === repo.nameWithOwner;
          const trackedPullRequestCount =
            trackedPullRequestCountsByRepo.get(repo.nameWithOwner) ?? 0;

          return (
            <button
              className="flex min-h-24 flex-col rounded-md border border-transparent bg-surface p-4 text-left transition hover:border-ink-200 hover:bg-canvasDark focus-visible:border-ink-400 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={savingRepoName !== null}
              key={repo.nameWithOwner}
              onClick={() => onSelectRepo(repo)}
              type="button"
            >
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <img
                    alt={`${getOwnerLogin(repo.nameWithOwner)} avatar`}
                    className="size-4 shrink-0 rounded-full object-cover"
                    loading="lazy"
                    src={getOwnerAvatarUrl(repo.nameWithOwner)}
                  />
                  <h2 className="truncate font-semibold tracking-tight text-xl text-ink-900">
                    {repo.nameWithOwner}
                  </h2>
                  {repo.isPrivate ? (
                    <span className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-ink-500">
                      Private
                    </span>
                  ) : null}
                </div>
                {repo.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-ink-500">
                    {repo.description}
                  </p>
                )}
              </div>
              <div className="mt-auto flex min-w-0 items-end justify-between gap-4 pt-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-sm text-ink-500">
                    <RepoMetric
                      icon={TablerStars}
                      label="stars"
                      value={repo.stargazerCount}
                    />
                    <RepoMetric
                      icon={TablerArrowFork}
                      label="forks"
                      value={repo.forkCount}
                    />
                    <RepoMetric
                      icon={OcticonIssueOpened24}
                      label="issues"
                      value={repo.issueCount}
                    />
                    <RepoMetric
                      icon={TablerGitPullRequest}
                      label="PRs"
                      value={repo.pullRequestCount}
                    />
                  </div>
                  {repo.languages.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {repo.languages.slice(0, 4).map((language) => (
                        <RepoLanguagePill
                          key={language.name}
                          language={language}
                        />
                      ))}
                      {repo.languages.length > 4 ? (
                        <span className="px-1.5 py-0.5 text-[11px] text-ink-500">
                          +{repo.languages.length - 4}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {isSaving ? (
                  <span className="shrink-0 whitespace-nowrap text-sm font-medium text-ink-500">
                    Saving...
                  </span>
                ) : isSelected && trackedPullRequestCount > 0 ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-medium text-green-600">
                    <CheckCircleIcon aria-hidden="true" className="size-5" />
                    {formatPullRequestAddedLabel(trackedPullRequestCount)}
                  </span>
                ) : null}
              </div>
              {!isSaving && !isSelected ? (
                <span className="sr-only">Select repository</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

type RepoLanguagePillProps = {
  language: RepoLanguage;
};

function RepoLanguagePill({ language }: RepoLanguagePillProps) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-ink-600">
      <FileTreeIcon
        className="size-3 shrink-0"
        path={getLanguageIconPath(language.name)}
      />
      <span className="truncate">{language.name}</span>
    </span>
  );
}

type RepoMetricProps = {
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  value: number | null;
};

function RepoMetric({ icon: Icon, label, value }: RepoMetricProps) {
  if (value === null) return null;

  return (
    <span className="inline-flex items-center gap-1">
      {Icon ? (
        <Icon aria-hidden="true" className="size-4 shrink-0" />
      ) : null}
      {formatCount(value)} {label}
    </span>
  );
}

function formatCount(value: number) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value >= 1000 ? 1 : 0,
    notation: value >= 1000 ? "compact" : "standard",
  }).format(value);
}

function formatPullRequestAddedLabel(count: number) {
  return `${count} ${count === 1 ? "PR" : "PRs"}`;
}

function recentPullRequests(pullRequests: PullRequestSummary[]) {
  return [...pullRequests].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

function upsertRepo(current: RepoSummary[] | undefined, repo: RepoSummary) {
  if (!current) return [repo];
  if (current.some((item) => item.nameWithOwner === repo.nameWithOwner)) {
    return current;
  }
  return [...current, repo];
}

function upsertPullRequest(
  current: PullRequestSummary[] | undefined,
  pullRequest: PullRequestSummary,
) {
  if (!current) return [pullRequest];
  if (current.some((item) => item.number === pullRequest.number)) {
    return current;
  }
  return [...current, pullRequest];
}

function getPullRequestKey(repo: string, number: number) {
  return `${repo}#${number}`;
}

const LANGUAGE_ICON_PATH_BY_NAME: Record<string, string> = {
  astro: "language.astro",
  c: "language.c",
  "c++": "language.cpp",
  coffeescript: "language.js",
  css: "language.css",
  dockerfile: "Dockerfile",
  go: "language.go",
  graphql: "schema.graphql",
  html: "language.html",
  javascript: "language.js",
  json: "data.json",
  less: "language.css",
  markdown: "README.md",
  mdx: "content.mdx",
  python: "language.py",
  ruby: "language.rb",
  rust: "language.rs",
  sass: "language.sass",
  scss: "language.scss",
  shell: "language.sh",
  svelte: "language.svelte",
  svg: "image.svg",
  swift: "language.swift",
  terraform: "main.tf",
  typescript: "language.ts",
  vue: "language.vue",
  webassembly: "module.wasm",
  yaml: "config.yml",
  zig: "language.zig",
};

function getLanguageIconPath(languageName: string) {
  const normalizedName = languageName.trim().toLowerCase();
  return (
    LANGUAGE_ICON_PATH_BY_NAME[normalizedName] ?? `language.${normalizedName}`
  );
}

export { RepositoryStep };

function useOnboardingRepoDiscovery(searchQuery: string) {
  const [isDiscoveryEnabled, setIsDiscoveryEnabled] = useState(false);
  const trimmedQuery = searchQuery.trim();

  useEffect(() => {
    let timeoutId: number | null = null;
    const frameId = window.requestAnimationFrame(() => {
      timeoutId = window.setTimeout(() => {
        setIsDiscoveryEnabled(true);
      }, 0);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  const initialQuery = useQuery({
    ...initialReposQueryOptions(ONBOARDING_INITIAL_REPO_LIMIT),
    enabled: isDiscoveryEnabled && trimmedQuery.length === 0,
  });
  const searchQueryResult = useQuery({
    ...searchReposQueryOptions(trimmedQuery, ONBOARDING_SEARCH_REPO_LIMIT),
    enabled: isDiscoveryEnabled && trimmedQuery.length > 0,
  });
  const activeQuery =
    trimmedQuery.length > 0 ? searchQueryResult : initialQuery;

  return {
    ...activeQuery,
    isPending: !isDiscoveryEnabled || activeQuery.isPending,
  };
}
