import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useWorkerPool } from "@pierre/diffs/react";
import { DIFFS_TAG_NAME, type FileDiffMetadata } from "@pierre/diffs";
import type { GitStatusEntry } from "@pierre/trees";
import { RepoSidebar } from "./components/ui/repo-sidebar";
import { TrackPullRequestModal } from "./components/ui/track-pull-request-modal";
import { PatchViewerMain } from "./components/ui/patch-viewer-main";
import { GhCliGateScreen } from "./components/ui/gh-cli-gate-screen";
import {
  getErrorMessage,
  useRepoPickerRepos,
  useSavedRepos,
  useSelectedPullRequestData,
  useTrackedPullRequests,
} from "./hooks/use-github-queries";
import { useTheme } from "./hooks/use-theme";
import { buildReviewThreadsByFile } from "./lib/review-threads";
import {
  ghCliStatusQueryOptions,
  githubKeys,
  pullRequestListQueryOptions,
  savedReposQueryOptions,
} from "./queries/github";
import type {
  FileStatsEntry,
  GhCliStatus,
  GhCliStatusKind,
  PullRequestSummary,
  RepoSummary,
  SelectedPullRequest,
} from "./types/github";

type ParsedPatchState = {
  fileDiffs: FileDiffMetadata[];
  parseError: string;
  isParsing: boolean;
};

type ParsePatchWorkerRequest = {
  type: "parse-patch";
  requestId: number;
  patch: string;
  cacheKeyPrefix: string;
  contextSize: number;
};

type ParsePatchWorkerResponse =
  | {
      type: "parse-patch-success";
      requestId: number;
      fileDiffs: FileDiffMetadata[];
    }
  | {
      type: "parse-patch-error";
      requestId: number;
      error: string;
    };

const AGGRESSIVE_PATCH_CONTEXT_SIZE = 3;
// Manual simulation override for GH CLI preflight.
// Set to one of: "ready", "missing_cli", "not_authenticated", "unknown_error".
const GH_CLI_STATUS_OVERRIDE: GhCliStatusKind | null = null;
type PullRequestPickerMode = "repo-then-pr" | "pr-only";
type PullRequestPickerStep = "repo" | "pull-request";

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

function MainApp() {
  const queryClient = useQueryClient();
  const { isDark, toggleTheme } = useTheme();
  const workerPool = useWorkerPool();
  const [selectedPr, setSelectedPr] = useState<SelectedPullRequest | null>(
    null,
  );

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<PullRequestPickerMode>(
    "repo-then-pr",
  );
  const [pickerStep, setPickerStep] = useState<PullRequestPickerStep>("repo");
  const [pickerRepo, setPickerRepo] = useState<RepoSummary | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isSavingRepo, setIsSavingRepo] = useState(false);
  const [isTrackingPullRequest, setIsTrackingPullRequest] = useState(false);
  const [openRepoValues, setOpenRepoValues] = useState<string[]>([]);
  const [parsedPatch, setParsedPatch] = useState<ParsedPatchState>({
    fileDiffs: [],
    parseError: "",
    isParsing: false,
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const patchParserWorkerRef = useRef<Worker | null>(null);
  const parseRequestIdRef = useRef(0);
  const refreshedReposRef = useRef<Set<string>>(new Set());
  const previousRepoNamesRef = useRef<string[]>([]);

  const updateSearch = useCallback((value: string) => {
    setSearchQuery(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(value), 300);
  }, []);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const { repos = [] } = useSavedRepos();
  const { availableRepos, availableReposError, isLoadingRepos } =
    useRepoPickerRepos(debouncedQuery);
  const { prsByRepo, repoErrors, refreshTrackedPullRequests } =
    useTrackedPullRequests({
      repos,
      setSelectedPr,
    });

  useEffect(() => {
    const worker = new Worker(
      new URL("./pierre-patch-parser-worker.ts", import.meta.url),
      { type: "module" },
    );

    patchParserWorkerRef.current = worker;

    const handleWorkerMessage = (
      event: MessageEvent<ParsePatchWorkerResponse>,
    ) => {
      const message = event.data;
      if (message.requestId !== parseRequestIdRef.current) {
        return;
      }

      startTransition(() => {
        if (message.type === "parse-patch-success") {
          setParsedPatch({
            fileDiffs: message.fileDiffs,
            parseError: "",
            isParsing: false,
          });
          return;
        }

        setParsedPatch({
          fileDiffs: [],
          parseError: message.error,
          isParsing: false,
        });
      });
    };

    worker.addEventListener("message", handleWorkerMessage);

    return () => {
      worker.removeEventListener("message", handleWorkerMessage);
      worker.terminate();
      patchParserWorkerRef.current = null;
    };
  }, []);

  const selectedPrKey = selectedPr
    ? `${selectedPr.repo}#${selectedPr.number}@${selectedPr.headSha}`
    : null;
  const {
    changedFiles,
    changedFilesError,
    isChangedFilesLoading,
    isPatchLoading,
    isReviewThreadsLoading,
    patchError,
    reviewThreads,
    reviewThreadsError,
    selectedPatch,
  } = useSelectedPullRequestData(selectedPr);
  const reviewThreadsByFile = useMemo(
    () => buildReviewThreadsByFile(reviewThreads),
    [reviewThreads],
  );

  const addedRepoKeys = useMemo(
    () => new Set(repos.map((r) => r.nameWithOwner)),
    [repos],
  );

  const filteredRepos = useMemo(
    () => availableRepos.filter((r) => !addedRepoKeys.has(r.nameWithOwner)),
    [availableRepos, addedRepoKeys],
  );
  const repoNames = useMemo(
    () => repos.map((repo) => repo.nameWithOwner),
    [repos],
  );
  const pickerRepoName = pickerRepo?.nameWithOwner ?? null;
  const pickerOpenPullRequestsQuery = useQuery({
    ...pullRequestListQueryOptions(pickerRepoName ?? "__idle__"),
    enabled:
      isPickerOpen &&
      pickerStep === "pull-request" &&
      pickerRepoName !== null,
  });
  const pickerOpenPullRequests = pickerOpenPullRequestsQuery.data ?? [];
  const trackedPrNumbersForPicker = useMemo(() => {
    if (!pickerRepoName) return new Set<number>();
    const trackedPullRequests = prsByRepo[pickerRepoName] ?? [];
    return new Set(trackedPullRequests.map((pullRequest) => pullRequest.number));
  }, [pickerRepoName, prsByRepo]);
  const addablePullRequests = useMemo(
    () =>
      pickerOpenPullRequests.filter(
        (pullRequest) => !trackedPrNumbersForPicker.has(pullRequest.number),
      ),
    [pickerOpenPullRequests, trackedPrNumbersForPicker],
  );
  const pickerPullRequestsError = getErrorMessage(pickerOpenPullRequestsQuery.error);

  useEffect(() => {
    if (!workerPool) return;

    void workerPool.setRenderOptions({
      theme: isDark ? "pierre-dark" : "pierre-light",
    });
  }, [isDark, workerPool]);

  useEffect(() => {
    const previousRepoNames = previousRepoNamesRef.current;
    const addedRepoNames = repoNames.filter(
      (repoName) => !previousRepoNames.includes(repoName),
    );

    setOpenRepoValues((current) => {
      const nextOpenRepos = current.filter((repoName) =>
        repoNames.includes(repoName),
      );

      for (const repoName of addedRepoNames) {
        if (!nextOpenRepos.includes(repoName)) {
          nextOpenRepos.push(repoName);
        }
      }

      if (
        nextOpenRepos.length === current.length &&
        nextOpenRepos.every((repoName, index) => repoName === current[index])
      ) {
        return current;
      }

      return nextOpenRepos;
    });

    previousRepoNamesRef.current = repoNames;
  }, [repoNames]);

  useEffect(() => {
    parseRequestIdRef.current += 1;

    if (!selectedPatch?.patch) {
      setParsedPatch({ fileDiffs: [], parseError: "", isParsing: false });
      return;
    }

    setParsedPatch({ fileDiffs: [], parseError: "", isParsing: true });

    patchParserWorkerRef.current?.postMessage({
      type: "parse-patch",
      requestId: parseRequestIdRef.current,
      patch: selectedPatch.patch,
      cacheKeyPrefix: `${selectedPatch.repo}-${selectedPatch.number}-${selectedPatch.headSha}`,
      // Be aggressive here: the review UI only needs enough surrounding lines
      // to orient the reader before Pierre's expand/collapse affordances take over.
      contextSize: AGGRESSIVE_PATCH_CONTEXT_SIZE,
    } satisfies ParsePatchWorkerRequest);
  }, [selectedPatch]);

  useEffect(() => {
    for (const repo of repos) {
      const repoName = repo.nameWithOwner;
      if (refreshedReposRef.current.has(repoName)) {
        continue;
      }

      refreshedReposRef.current.add(repoName);
      void refreshTrackedPullRequests(repoName);
    }
  }, [refreshTrackedPullRequests, repos]);

  const isPatchPreparing = isPatchLoading || parsedPatch.isParsing;

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
  }, [parsedPatch.fileDiffs]);

  const gitStatus = useMemo(() => {
    if (!fileStats) return undefined;
    const entries: GitStatusEntry[] = [];
    for (const [path, entry] of fileStats) {
      entries.push({ path, status: entry.status });
    }
    return entries;
  }, [fileStats]);

  async function handleRepoOpenChange(repo: string, open: boolean) {
    setOpenRepoValues((current) => {
      if (open) {
        return current.includes(repo) ? current : [...current, repo];
      }

      return current.filter((value) => value !== repo);
    });
  }

  function handleSelectPr(repo: string, pullRequest: PullRequestSummary) {
    setSelectedPr({
      repo,
      number: pullRequest.number,
      headSha: pullRequest.headSha,
    });

    if (!refreshedReposRef.current.has(repo)) {
      refreshedReposRef.current.add(repo);
    }
    void refreshTrackedPullRequests(repo);
  }

  function resetPickerState() {
    setSearchQuery("");
    setDebouncedQuery("");
    setPickerStep(pickerMode === "pr-only" ? "pull-request" : "repo");
    if (pickerMode === "repo-then-pr") {
      setPickerRepo(null);
    }
  }

  function openRepoPicker() {
    setPickerMode("repo-then-pr");
    setPickerStep("repo");
    setPickerRepo(null);
    setIsPickerOpen(true);
  }

  function openRepoPullRequestPicker(repoNameWithOwner: string) {
    const repo = repos.find((candidate) => candidate.nameWithOwner === repoNameWithOwner);
    if (!repo) return;
    setPickerMode("pr-only");
    setPickerStep("pull-request");
    setPickerRepo(repo);
    setIsPickerOpen(true);
  }

  async function handlePickRepo(repo: RepoSummary) {
    setIsSavingRepo(true);
    try {
      const savedRepo = await invoke<RepoSummary>("save_repo", { repo });
      queryClient.setQueryData<RepoSummary[]>(
        savedReposQueryOptions().queryKey,
        (current) => {
          if (!current) return [savedRepo];
          if (
            current.some(
              (item) => item.nameWithOwner === savedRepo.nameWithOwner,
            )
          ) {
            return current;
          }
          return [...current, savedRepo];
        },
      );

      setPickerRepo(savedRepo);
      setPickerStep("pull-request");
      setOpenRepoValues((current) =>
        current.includes(savedRepo.nameWithOwner)
          ? current
          : [...current, savedRepo.nameWithOwner],
      );
    } finally {
      setIsSavingRepo(false);
    }
  }

  async function handleTrackPullRequest(pullRequest: PullRequestSummary) {
    if (!pickerRepoName) return;

    setIsTrackingPullRequest(true);
    try {
      const trackedPullRequest = await invoke<PullRequestSummary>("track_pull_request", {
        repo: pickerRepoName,
        pullRequest,
      });
      queryClient.setQueryData<PullRequestSummary[]>(
        githubKeys.trackedPullRequestList(pickerRepoName),
        (current) => {
          const list = current ?? [];
          const withoutCurrent = list.filter(
            (item) => item.number !== trackedPullRequest.number,
          );
          return [trackedPullRequest, ...withoutCurrent];
        },
      );

      setSelectedPr({
        repo: pickerRepoName,
        number: trackedPullRequest.number,
        headSha: trackedPullRequest.headSha,
      });
      setIsPickerOpen(false);
      resetPickerState();
    } finally {
      setIsTrackingPullRequest(false);
    }
  }

  async function handleRemoveTrackedPullRequest(
    repo: string,
    pullRequest: PullRequestSummary,
  ) {
    await invoke("remove_tracked_pull_request", {
      repo,
      number: pullRequest.number,
    });
    queryClient.setQueryData<PullRequestSummary[]>(
      githubKeys.trackedPullRequestList(repo),
      (current) =>
        (current ?? []).filter((item) => item.number !== pullRequest.number),
    );

    setSelectedPr((current) => {
      if (!current) return current;
      if (current.repo !== repo || current.number !== pullRequest.number) {
        return current;
      }
      return null;
    });
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas text-ink-900">
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 w-1/4 min-w-[15%] shrink-0">
          <RepoSidebar
            repos={repos}
            prsByRepo={prsByRepo}
            repoErrors={repoErrors}
            openValues={openRepoValues}
            selectedPrKey={selectedPrKey}
            isDark={isDark}
            onAddRepo={openRepoPicker}
            onAddPr={(repo) => openRepoPullRequestPicker(repo)}
            onToggleTheme={toggleTheme}
            onSelectPr={(name, pr) => void handleSelectPr(name, pr)}
            onRemovePr={(repo, pullRequest) =>
              void handleRemoveTrackedPullRequest(repo, pullRequest)
            }
            onRepoOpenChange={(repo, open) =>
              void handleRepoOpenChange(repo, open)
            }
          />
        </div>
        <div className="min-h-0 min-w-[30%] flex-1">
          <PatchViewerMain
            selectedPrKey={selectedPrKey}
            selectedPatch={selectedPatch}
            isPatchLoading={isPatchPreparing}
            isDark={isDark}
            patchError={patchError}
            changedFiles={changedFiles}
            isChangedFilesLoading={isChangedFilesLoading}
            changedFilesError={changedFilesError}
            reviewThreadsByFile={reviewThreadsByFile}
            reviewThreads={reviewThreads}
            isReviewThreadsLoading={isReviewThreadsLoading}
            reviewThreadsError={reviewThreadsError}
            parsedPatch={parsedPatch}
            fileStats={fileStats}
            gitStatus={gitStatus}
          />
        </div>
      </div>

      <TrackPullRequestModal
        open={isPickerOpen}
        onOpenChange={(open) => {
          setIsPickerOpen(open);
          if (!open) {
            resetPickerState();
          }
        }}
        mode={pickerMode}
        step={pickerStep}
        selectedRepo={pickerRepo}
        searchQuery={searchQuery}
        onSearchChange={updateSearch}
        isLoadingRepos={isLoadingRepos}
        availableReposError={availableReposError}
        filteredRepos={filteredRepos}
        isSavingRepo={isSavingRepo}
        onPickRepo={(repo) => void handlePickRepo(repo)}
        pullRequests={addablePullRequests}
        isLoadingPullRequests={
          isPickerOpen &&
          pickerStep === "pull-request" &&
          pickerRepoName !== null &&
          pickerOpenPullRequestsQuery.isPending
        }
        pullRequestsError={pickerPullRequestsError}
        isTrackingPullRequest={isTrackingPullRequest}
        onPickPullRequest={(pullRequest) =>
          void handleTrackPullRequest(pullRequest)
        }
        onBack={() => {
          setPickerStep("repo");
          setPickerRepo(null);
        }}
      />
    </div>
  );
}

function App() {
  const queryClient = useQueryClient();
  const ghCliStatusQuery = useQuery({
    ...ghCliStatusQueryOptions(),
    enabled: GH_CLI_STATUS_OVERRIDE === null,
  });
  const simulatedGhCliStatus: GhCliStatus | null = GH_CLI_STATUS_OVERRIDE
    ? {
        status: GH_CLI_STATUS_OVERRIDE,
        message: "Simulated via GH_CLI_STATUS_OVERRIDE in App.tsx.",
      }
    : null;
  const ghCliStatus = simulatedGhCliStatus ?? ghCliStatusQuery.data ?? null;
  const isCheckingGhCli =
    GH_CLI_STATUS_OVERRIDE === null &&
    (ghCliStatusQuery.isPending || ghCliStatusQuery.isFetching);
  const ghCliStatusMessage =
    ghCliStatus?.message ?? (getErrorMessage(ghCliStatusQuery.error) || null);

  const checkAgain = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: githubKeys.ghCliStatus(),
    });
  }, [queryClient]);

  if (isCheckingGhCli) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-white">
        <p className="text-center text-base">check for gh auth status</p>
      </div>
    );
  }

  if (!ghCliStatus || ghCliStatus.status !== "ready") {
    return (
      <GhCliGateScreen
        status={ghCliStatus?.status ?? "unknown_error"}
        message={ghCliStatusMessage}
        isChecking={isCheckingGhCli}
        onCheckAgain={checkAgain}
      />
    );
  }

  return <MainApp />;
}

export default App;
