import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { Group, Panel, Separator } from "react-resizable-panels";
import { DIFFS_TAG_NAME, type FileDiffMetadata } from "@pierre/diffs";
import type { GitStatusEntry } from "@pierre/trees";
import { AppUpdater } from "./components/ui/app-updater";
import { RepoSidebar } from "./components/ui/repo-sidebar";
import { AddRepoModal } from "./components/ui/add-repo-modal";
import { PatchViewerMain } from "./components/ui/patch-viewer-main";
import {
  useRepoPickerRepos,
  useRepoPullRequests,
  useSavedRepos,
  useSelectedPullRequestData,
} from "./hooks/use-github-queries";
import { buildReviewThreadsByFile } from "./lib/review-threads";
import { savedReposQueryOptions } from "./queries/github";
import type {
  FileStatsEntry,
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
  const [selectedPr, setSelectedPr] = useState<SelectedPullRequest | null>(
    null,
  );

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isAddingRepo, setIsAddingRepo] = useState(false);
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

  const updateSearch = useCallback((value: string) => {
    setSearchQuery(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(value), 300);
  }, []);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const { repos = [] } = useSavedRepos();
  const { availableRepos, availableReposError, isLoadingRepos } =
    useRepoPickerRepos(debouncedQuery);
  const { loadingRepos, loadPullRequests, prsByRepo, repoErrors } =
    useRepoPullRequests({
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

  async function handlePickRepo(repo: RepoSummary) {
    setIsAddingRepo(true);

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

      setIsPickerOpen(false);
      await loadPullRequests(savedRepo.nameWithOwner);
    } finally {
      setIsAddingRepo(false);
    }
  }

  async function handleRepoOpenChange(repo: string, open: boolean) {
    if (open && !loadingRepos[repo]) {
      await loadPullRequests(repo);
    }
  }

  function handleSelectPr(repo: string, pullRequest: PullRequestSummary) {
    setSelectedPr({
      repo,
      number: pullRequest.number,
      headSha: pullRequest.headSha,
    });
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas">
      {/* <div className="flex w-full shrink-0 items-center gap-3 px-3 py-2 pl-20">
        <div></div>
        <AppUpdater />
      </div> */}
      <Group orientation="horizontal" className="min-h-0 flex-1">
        {/* <p className="m-0 min-w-0 flex-1 truncate text-center text-sm leading-tight text-neutral-500">
          {selectedPr
            ? `${selectedPr.repo} · PR #${selectedPr.number}`
            : "Select a pull request to preview its patch"}
        </p> */}
        <Panel defaultSize="25%" minSize="15%">
          <RepoSidebar
            repos={repos}
            prsByRepo={prsByRepo}
            loadingRepos={loadingRepos}
            repoErrors={repoErrors}
            defaultOpenValues={[]}
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
            isPatchLoading={isPatchPreparing}
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
