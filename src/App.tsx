import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
  DIFFS_TAG_NAME,
  parsePatchFiles,
  type FileDiffMetadata,
} from "@pierre/diffs";
import type { GitStatusEntry } from "@pierre/trees";
import type { PullRequestSummary } from "./components/ui/repo-sidebar-item";
import { RepoSidebar, type RepoSummary } from "./components/ui/repo-sidebar";
import { AddRepoModal } from "./components/ui/add-repo-modal";
import { PatchViewerMain } from "./components/ui/patch-viewer-main";
import { mockRepos, mockPrsByRepo } from "./data/mock";
import type { ReviewThread } from "./lib/review-threads";

type PrPatch = {
  repo: string;
  number: number;
  patch: string;
};

type FileStatsEntry = {
  additions: number;
  deletions: number;
  status: GitStatusEntry["status"];
};

type SelectedPullRequest = {
  repo: string;
  number: number;
};

type PullRequestDetailQueryResult = {
  patchResult: PromiseSettledResult<PrPatch>;
  filesResult: PromiseSettledResult<string[]>;
  reviewThreadsResult: PromiseSettledResult<ReviewThread[]>;
};

const initialReposQueryOptions = {
  queryKey: ["initial-repos"] as const,
  queryFn: () => invoke<RepoSummary[]>("list_initial_repos", { limit: 5 }),
  staleTime: 5 * 60 * 1000,
};

function searchReposQueryOptions(query: string) {
  return {
    queryKey: ["repo-search", query] as const,
    queryFn: () => invoke<RepoSummary[]>("search_repos", { query, limit: 20 }),
    staleTime: 5 * 60 * 1000,
  };
}

if (typeof HTMLElement !== "undefined" && !customElements.get(DIFFS_TAG_NAME)) {
  class DiffsContainerElement extends HTMLElement {
    constructor() {
      super();
      if (!this.shadowRoot) {
        this.attachShadow({ mode: "open" });
      }
    }
  }

  customElements.define(DIFFS_TAG_NAME, DiffsContainerElement);
}

function App() {
  const queryClient = useQueryClient();
  const [repos, setRepos] = useState<RepoSummary[]>(mockRepos);
  const [prsByRepo, setPrsByRepo] =
    useState<Record<string, PullRequestSummary[]>>(mockPrsByRepo);
  const [loadingRepos, setLoadingRepos] = useState<Record<string, boolean>>({});
  const [repoErrors, setRepoErrors] = useState<Record<string, string>>({});
  const [selectedPr, setSelectedPr] = useState<SelectedPullRequest | null>(null);

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isAddingRepo, setIsAddingRepo] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const updateSearch = useCallback((value: string) => {
    setSearchQuery(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(value), 300);
  }, []);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const { data: initialRepos = [], isPending: isInitialLoading } = useQuery(
    initialReposQueryOptions,
  );

  const {
    data: searchRepos = [],
    error: searchError,
    isPending: isSearchLoading,
  } = useQuery({
    ...searchReposQueryOptions(debouncedQuery),
    enabled: debouncedQuery.trim().length > 0,
  });

  useEffect(() => {
    void queryClient.prefetchQuery(initialReposQueryOptions);
  }, [queryClient]);

  const selectedPrKey = selectedPr
    ? `${selectedPr.repo}#${selectedPr.number}`
    : null;

  const selectedPullRequestQuery = useQuery<PullRequestDetailQueryResult>({
    queryKey: ["pull-request-detail", selectedPr?.repo, selectedPr?.number],
    enabled: selectedPr !== null,
    queryFn: async () => {
      const repo = selectedPr?.repo;
      const number = selectedPr?.number;

      if (!repo || number === undefined) {
        throw new Error("A pull request must be selected before loading details.");
      }

      const [patchResult, filesResult, reviewThreadsResult] =
        await Promise.allSettled([
          invoke<PrPatch>("get_pull_request_patch", {
            repo,
            number,
          }),
          invoke<string[]>("list_pull_request_changed_files", {
            repo,
            number,
          }),
          invoke<ReviewThread[]>("get_pull_request_review_threads", {
            repo,
            number,
          }),
        ]);

      return {
        patchResult,
        filesResult,
        reviewThreadsResult,
      };
    },
  });

  const selectedPatch =
    selectedPullRequestQuery.data?.patchResult.status === "fulfilled"
      ? selectedPullRequestQuery.data.patchResult.value
      : null;
  const changedFiles =
    selectedPullRequestQuery.data?.filesResult.status === "fulfilled"
      ? selectedPullRequestQuery.data.filesResult.value
      : [];
  const reviewThreads =
    selectedPullRequestQuery.data?.reviewThreadsResult.status === "fulfilled"
      ? selectedPullRequestQuery.data.reviewThreadsResult.value
      : [];
  const patchError =
    selectedPullRequestQuery.data?.patchResult.status === "rejected"
      ? selectedPullRequestQuery.data.patchResult.reason instanceof Error
        ? selectedPullRequestQuery.data.patchResult.reason.message
        : String(selectedPullRequestQuery.data.patchResult.reason)
      : "";
  const changedFilesError =
    selectedPullRequestQuery.data?.filesResult.status === "rejected"
      ? selectedPullRequestQuery.data.filesResult.reason instanceof Error
        ? selectedPullRequestQuery.data.filesResult.reason.message
        : String(selectedPullRequestQuery.data.filesResult.reason)
      : "";
  const reviewThreadsError =
    selectedPullRequestQuery.data?.reviewThreadsResult.status === "rejected"
      ? selectedPullRequestQuery.data.reviewThreadsResult.reason instanceof Error
        ? selectedPullRequestQuery.data.reviewThreadsResult.reason.message
        : String(selectedPullRequestQuery.data.reviewThreadsResult.reason)
      : "";
  const isPatchLoading =
    selectedPullRequestQuery.isPending || selectedPullRequestQuery.isFetching;
  const isChangedFilesLoading =
    selectedPullRequestQuery.isPending || selectedPullRequestQuery.isFetching;
  const isReviewThreadsLoading =
    selectedPullRequestQuery.isPending || selectedPullRequestQuery.isFetching;

  const availableRepos =
    debouncedQuery.trim().length > 0 ? searchRepos : initialRepos;
  const isLoadingRepos =
    debouncedQuery.trim().length > 0 ? isSearchLoading : isInitialLoading;
  const availableReposError = searchError;

  const addedRepoKeys = useMemo(
    () => new Set(repos.map((r) => r.nameWithOwner)),
    [repos],
  );

  const filteredRepos = useMemo(
    () => availableRepos.filter((r) => !addedRepoKeys.has(r.nameWithOwner)),
    [availableRepos, addedRepoKeys],
  );

  const parsedPatch = useMemo(() => {
    if (!selectedPatch?.patch) {
      return { fileDiffs: [] as FileDiffMetadata[], parseError: "" };
    }

    try {
      const fileDiffs = parsePatchFiles(selectedPatch.patch).flatMap(
        (patch) => patch.files,
      );
      return { fileDiffs, parseError: "" };
    } catch (error) {
      return {
        fileDiffs: [] as FileDiffMetadata[],
        parseError:
          error instanceof Error
            ? error.message
            : "Failed to parse the PR patch.",
      };
    }
  }, [selectedPatch]);

  const fileStats = useMemo(() => {
    if (parsedPatch.fileDiffs.length === 0) return null;
    const map = new Map<string, FileStatsEntry>();
    for (const fd of parsedPatch.fileDiffs) {
      const status: GitStatusEntry["status"] =
        fd.type === "new"
          ? "added"
          : fd.type === "deleted"
            ? "deleted"
            : "modified";
      map.set(fd.name, {
        additions: fd.additionLines.length,
        deletions: fd.deletionLines.length,
        status,
      });
    }
    return map;
  }, [parsedPatch]);

  const gitStatus = useMemo(() => {
    if (!fileStats) return undefined;
    const entries: GitStatusEntry[] = [];
    for (const [path, entry] of fileStats) {
      entries.push({ path, status: entry.status });
    }
    return entries;
  }, [fileStats]);

  async function loadPullRequests(repo: string) {
    setLoadingRepos((current) => ({ ...current, [repo]: true }));
    setRepoErrors((current) => ({ ...current, [repo]: "" }));

    try {
      const pullRequests = await invoke<PullRequestSummary[]>(
        "list_pull_requests",
        { repo },
      );
      setPrsByRepo((current) => ({ ...current, [repo]: pullRequests }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRepoErrors((current) => ({ ...current, [repo]: message }));
    } finally {
      setLoadingRepos((current) => ({ ...current, [repo]: false }));
    }
  }

  async function handlePickRepo(repo: RepoSummary) {
    setIsAddingRepo(true);

    try {
      setRepos((current) => [...current, repo]);
      setIsPickerOpen(false);
      await loadPullRequests(repo.nameWithOwner);
    } finally {
      setIsAddingRepo(false);
    }
  }

  async function handleRepoOpenChange(repo: string, open: boolean) {
    if (open && prsByRepo[repo] === undefined && !loadingRepos[repo]) {
      await loadPullRequests(repo);
    }
  }

  function handleSelectPr(repo: string, pullRequest: PullRequestSummary) {
    setSelectedPr({ repo, number: pullRequest.number });
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas">
      <div className="flex w-full shrink-0 items-center justify-center pt-2">
        <p className="m-0 leading-tight text-neutral-500">
          {selectedPr
            ? `${selectedPr.repo} · PR #${selectedPr.number}`
            : "Select a pull request to preview its patch"}
        </p>
      </div>
      <Group orientation="horizontal" className="min-h-0 flex-1">
        <Panel defaultSize="25%" minSize="15%">
          <RepoSidebar
            repos={repos}
            prsByRepo={prsByRepo}
            loadingRepos={loadingRepos}
            repoErrors={repoErrors}
            defaultOpenValues={mockRepos.map((r) => r.nameWithOwner)}
            onAddRepo={() => setIsPickerOpen(true)}
            onSelectPr={(name, pr) => void handleSelectPr(name, pr)}
            onRepoOpenChange={(repo, open) =>
              void handleRepoOpenChange(repo, open)
            }
          />
        </Panel>
        <Separator className="w-1 shrink-0" />
        <Panel defaultSize="75%" minSize="30%">
          <PatchViewerMain
            selectedPrKey={selectedPrKey}
            selectedPatch={selectedPatch}
            isPatchLoading={isPatchLoading}
            patchError={patchError}
            changedFiles={changedFiles}
            isChangedFilesLoading={isChangedFilesLoading}
            changedFilesError={changedFilesError}
            reviewThreads={reviewThreads}
            isReviewThreadsLoading={isReviewThreadsLoading}
            reviewThreadsError={reviewThreadsError}
            parsedPatch={parsedPatch}
            fileStats={fileStats}
            gitStatus={gitStatus}
          />
        </Panel>
      </Group>

      <AddRepoModal
        open={isPickerOpen}
        onOpenChange={(open) => {
          setIsPickerOpen(open);
          if (!open) {
            setSearchQuery("");
            setDebouncedQuery("");
          }
        }}
        searchQuery={searchQuery}
        onSearchChange={updateSearch}
        isLoadingRepos={isLoadingRepos}
        availableReposError={availableReposError}
        availableRepos={availableRepos}
        filteredRepos={filteredRepos}
        isAddingRepo={isAddingRepo}
        onPickRepo={(repo) => void handlePickRepo(repo)}
      />
    </div>
  );
}

export default App;
export type { FileStatsEntry, PrPatch };
