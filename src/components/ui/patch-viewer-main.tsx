import { useCallback, useEffect, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import {
  ChevronDoubleLeftIcon,
  ListBulletIcon,
} from "@heroicons/react/24/outline";
import type {
  DiffLineAnnotation,
  FileDiffMetadata,
  VirtualFileMetrics,
  VirtualizerConfig,
} from "@pierre/diffs";
import type { GitStatusEntry } from "@pierre/trees";
import { FileDiff, Virtualizer } from "@pierre/diffs/react";
import { ChangedFilesTree } from "./changed-files-tree";
import { ReviewThreadCard } from "./review-thread-card";
import type { FileStatsEntry } from "../../App";
import {
  getFileReviewThreadsForPath,
  normalizePath,
  type FileReviewThreads,
  type ReviewThreadAnnotation,
} from "../../lib/review-threads";

const VIRTUALIZER_CONFIG: Partial<VirtualizerConfig> = {
  overscrollSize: 1200,
};

const VIRTUAL_FILE_METRICS: VirtualFileMetrics = {
  hunkLineCount: 50,
  lineHeight: 20,
  diffHeaderHeight: 44,
  hunkSeparatorHeight: 32,
  fileGap: 16,
};

type SelectedPatch = {
  repo: string;
  number: number;
  patch: string;
};

type PatchViewerMainProps = {
  selectedPrKey: string | null;
  selectedPatch: SelectedPatch | null;
  isPatchLoading: boolean;
  patchError: string;
  changedFiles: string[];
  isChangedFilesLoading: boolean;
  changedFilesError: string;
  reviewThreadsByFile: Map<string, FileReviewThreads>;
  isReviewThreadsLoading: boolean;
  reviewThreadsError: string;
  parsedPatch: {
    fileDiffs: FileDiffMetadata[];
    parseError: string;
  };
  fileStats: Map<string, FileStatsEntry> | null;
  gitStatus: GitStatusEntry[] | undefined;
};

function cx(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(" ");
}

function PatchViewerMain({
  selectedPrKey,
  selectedPatch,
  isPatchLoading,
  patchError,
  changedFiles,
  isChangedFilesLoading,
  changedFilesError,
  reviewThreadsByFile,
  isReviewThreadsLoading,
  reviewThreadsError,
  parsedPatch,
  fileStats,
  gitStatus,
}: PatchViewerMainProps) {
  const [isTreeHidden, setIsTreeHidden] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const pendingScrollPathRef = useRef<string | null>(null);
  const fileDiffRefMap = useRef<Map<string, HTMLDivElement>>(new Map());
  const hasSelection = selectedPrKey !== null;

  const setFileDiffRef = useCallback(
    (path: string, node: HTMLDivElement | null) => {
      if (node) {
        fileDiffRefMap.current.set(path, node);
        return;
      }

      fileDiffRefMap.current.delete(path);
    },
    [],
  );

  const scrollToDiffFile = useCallback((path: string) => {
    const normalizedTargetPath = normalizePath(path);

    const directMatch = fileDiffRefMap.current.get(path);
    if (directMatch) {
      directMatch.scrollIntoView({
        behavior: "auto",
        block: "start",
        inline: "nearest",
      });
      return true;
    }

    for (const [filePath, node] of fileDiffRefMap.current) {
      if (normalizePath(filePath) !== normalizedTargetPath) continue;
      node.scrollIntoView({
        behavior: "auto",
        block: "start",
        inline: "nearest",
      });
      return true;
    }

    return false;
  }, []);

  const handleSelectFile = useCallback(
    (path: string) => {
      setSelectedFilePath(path);

      if (scrollToDiffFile(path)) {
        pendingScrollPathRef.current = null;
        return;
      }

      pendingScrollPathRef.current = path;
    },
    [scrollToDiffFile],
  );

  useEffect(() => {
    setSelectedFilePath(null);
    pendingScrollPathRef.current = null;
    fileDiffRefMap.current.clear();
  }, [selectedPrKey]);

  useEffect(() => {
    const pendingPath = pendingScrollPathRef.current;
    if (!pendingPath || isPatchLoading || patchError || parsedPatch.parseError) {
      return;
    }

    if (scrollToDiffFile(pendingPath)) {
      pendingScrollPathRef.current = null;
    }
  }, [
    isPatchLoading,
    patchError,
    parsedPatch.fileDiffs,
    parsedPatch.parseError,
    scrollToDiffFile,
  ]);

  function renderReviewThreadSummary(fileReviewThreads: FileReviewThreads) {
    if (fileReviewThreads.totalCount === 0) {
      return null;
    }

    return (
      <div className="flex items-center gap-2 text-xs text-ink-500">
        <span className="rounded-full bg-canvas px-2 py-0.5 text-ink-700">
          {fileReviewThreads.totalCount} threads
        </span>
        <span
          className={cx(
            "rounded-full px-2 py-0.5",
            fileReviewThreads.unresolvedCount > 0
              ? "bg-amber-100 text-amber-700"
              : "bg-emerald-100 text-emerald-700",
          )}
        >
          {fileReviewThreads.unresolvedCount > 0
            ? `${fileReviewThreads.unresolvedCount} open`
            : "All resolved"}
        </span>
        {fileReviewThreads.fileThreads.length > 0 ? (
          <span className="text-ink-500">
            {fileReviewThreads.fileThreads.length} file-level
          </span>
        ) : null}
      </div>
    );
  }

  function renderReviewThreadAnnotations(
    annotation: DiffLineAnnotation<ReviewThreadAnnotation>,
  ) {
    return <ReviewThreadCard compact thread={annotation.metadata.thread} />;
  }

  return (
    <main className="h-full min-h-0 min-w-0 bg-canvas p-2">
      <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-surface">
        <div
          className={cx(
            "grid min-h-0 flex-1 min-w-0",
            isTreeHidden
              ? "grid-cols-1"
              : "grid-cols-[minmax(240px,1fr)_minmax(0,2fr)]",
          )}
        >
          {!isTreeHidden ? (
            <div className="sticky top-0 h-full min-h-0 min-w-0 self-start">
              <ChangedFilesTree
                error={changedFilesError}
                files={changedFiles}
                hasSelection={hasSelection}
                isLoading={isChangedFilesLoading}
                onHideTree={() => setIsTreeHidden(true)}
                onSelectFile={handleSelectFile}
                selectedFilePath={selectedFilePath}
                showContainer={false}
                fileStats={fileStats}
                gitStatus={gitStatus}
              />
            </div>
          ) : null}

          <Virtualizer
            className="relative min-h-0 min-w-0 overflow-y-auto"
            config={VIRTUALIZER_CONFIG}
            contentClassName="flex min-h-full flex-col"
          >
            {isTreeHidden ? (
              <div className="sticky top-0 z-10 flex justify-end p-2">
                <div className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-surface/95 p-1 shadow-sm backdrop-blur">
                  <Popover.Root>
                    <Popover.Trigger
                      aria-label="Open changed files"
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-ink-200 px-2 text-xs text-ink-600 transition hover:bg-canvas hover:text-ink-900"
                      type="button"
                    >
                      <ListBulletIcon className="size-4" />
                      Files
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Positioner
                        align="end"
                        side="bottom"
                        sideOffset={8}
                      >
                        <Popover.Popup className="z-50 w-[min(92vw,400px)] overflow-hidden rounded-xl border border-ink-300 bg-surface shadow-dialog">
                          <div className="h-[min(70vh,560px)] min-h-[320px]">
                            <ChangedFilesTree
                              error={changedFilesError}
                              files={changedFiles}
                              hasSelection={hasSelection}
                              isLoading={isChangedFilesLoading}
                              onSelectFile={handleSelectFile}
                              selectedFilePath={selectedFilePath}
                              showContainer={false}
                              fileStats={fileStats}
                              gitStatus={gitStatus}
                            />
                          </div>
                        </Popover.Popup>
                      </Popover.Positioner>
                    </Popover.Portal>
                  </Popover.Root>

                  <button
                    aria-label="Show changed files"
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-ink-200 px-2 text-xs text-ink-600 transition hover:bg-canvas hover:text-ink-900"
                    onClick={() => setIsTreeHidden(false)}
                    type="button"
                  >
                    <ChevronDoubleLeftIcon className="size-4 rotate-180" />
                    Show tree
                  </button>
                </div>
              </div>
            ) : null}

            {!selectedPrKey && !isPatchLoading ? (
              <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 px-6 py-10 text-center md:min-h-full">
                <strong>Select a pull request.</strong>
                <span className="text-sm text-ink-600">
                  The PR patch will render here with Pierre Diffs.
                </span>
              </div>
            ) : null}

            {isPatchLoading ? (
              <div className="flex min-h-[50vh] items-center justify-center px-6 py-10 text-center md:min-h-full">
                Loading patch...
              </div>
            ) : null}

            {!isPatchLoading && patchError ? (
              <div className="flex min-h-[50vh] items-center justify-center px-6 py-10 text-center text-danger-600 md:min-h-full">
                {patchError}
              </div>
            ) : null}

            {!isPatchLoading && !patchError && isReviewThreadsLoading ? (
              <div className="px-4 pb-2 pt-1 text-sm text-ink-500">
                Loading review threads...
              </div>
            ) : null}

            {!isPatchLoading && !patchError && reviewThreadsError ? (
              <div className="px-4 pb-2 pt-1 text-sm text-danger-600">
                {reviewThreadsError}
              </div>
            ) : null}

            {!isPatchLoading && !patchError && selectedPatch ? (
              <div className="flex min-h-[50vh] flex-col md:min-h-full">
                {parsedPatch.parseError ? (
                  <div className="flex min-h-[50vh] items-center justify-center px-6 py-10 text-center text-danger-600 md:min-h-full">
                    {parsedPatch.parseError}
                  </div>
                ) : parsedPatch.fileDiffs.length === 0 ? (
                  <pre className="m-0 overflow-auto whitespace-pre-wrap break-words p-5">
                    {selectedPatch.patch}
                  </pre>
                ) : (
                  <div className="flex flex-col gap-4 p-4">
                    {parsedPatch.fileDiffs.map((fileDiff, index) => {
                      const fileReviewThreads = getFileReviewThreadsForPath(
                        reviewThreadsByFile,
                        fileDiff.name,
                      );

                      return (
                        <div
                          data-file-path={fileDiff.name}
                          key={`${selectedPatch.repo}-${selectedPatch.number}-${index}`}
                          ref={(node) => setFileDiffRef(fileDiff.name, node)}
                        >
                          <FileDiff
                            fileDiff={fileDiff}
                            metrics={VIRTUAL_FILE_METRICS}
                            lineAnnotations={fileReviewThreads.lineAnnotations}
                            options={{
                              theme: { dark: "pierre-dark", light: "pierre-light" },
                              diffStyle: "unified",
                              diffIndicators: "bars",
                              lineDiffType: "word",
                              overflow: "scroll",
                            }}
                            renderAnnotation={renderReviewThreadAnnotations}
                            renderHeaderMetadata={() =>
                              renderReviewThreadSummary(fileReviewThreads)
                            }
                          />
                          {fileReviewThreads.fileThreads.length > 0 ? (
                            <div className="mt-3 flex flex-col gap-3 rounded-xl border border-ink-200 bg-surface p-3">
                              <div className="text-xs font-medium uppercase tracking-wide text-ink-500">
                                File threads
                              </div>
                              {fileReviewThreads.fileThreads.map((thread) => (
                                <ReviewThreadCard key={thread.id} thread={thread} />
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : null}
          </Virtualizer>
        </div>
      </section>
    </main>
  );
}

export { PatchViewerMain };
export type { PatchViewerMainProps };
