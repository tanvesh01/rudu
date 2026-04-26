import { useCallback, useEffect, useMemo, useRef } from "react";
import type { GitStatusEntry } from "@pierre/trees";
import { FileTree } from "@pierre/trees/react";
import { normalizePath } from "../../lib/review-threads";
import type { FileStatsEntry } from "../../types/github";

type ChangedFilesTreeProps = {
  files: string[];
  isLoading: boolean;
  error: string;
  hasSelection: boolean;
  showContainer?: boolean;
  onSelectFile?: (path: string) => void;
  selectedFilePath?: string | null;
  fileStats: Map<string, FileStatsEntry> | null;
  gitStatus: GitStatusEntry[] | undefined;
  chapterContext?: {
    title: string;
    detail: string;
  } | null;
  isDark: boolean;
};

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

function ChangedFilesTree({
  files,
  isLoading,
  error,
  hasSelection,
  showContainer = true,
  onSelectFile,
  selectedFilePath,
  fileStats,
  gitStatus,
  chapterContext,
  isDark,
}: ChangedFilesTreeProps) {
  const initialExpandedItems = useMemo(() => {
    const expandedDirs = new Set<string>();

    for (const file of files) {
      const parts = file.split("/");
      for (let i = 1; i < parts.length; i += 1) {
        expandedDirs.add(parts.slice(0, i).join("/"));
      }
    }

    return Array.from(expandedDirs);
  }, [files]);

  const fileSet = useMemo(() => new Set(files), [files]);
  const selectedTreeFilePath = useMemo(() => {
    if (!selectedFilePath) return null;
    if (fileSet.has(selectedFilePath)) return selectedFilePath;

    const normalizedSelectedPath = normalizePath(selectedFilePath);
    return (
      files.find((file) => normalizePath(file) === normalizedSelectedPath) ??
      null
    );
  }, [fileSet, files, selectedFilePath]);

  const totals = useMemo(() => {
    if (!fileStats) return null;
    const visibleFileSet = new Set(files.map((file) => normalizePath(file)));
    let additions = 0;
    let deletions = 0;
    for (const [path, entry] of fileStats) {
      if (!visibleFileSet.has(normalizePath(path))) {
        continue;
      }

      additions += entry.additions;
      deletions += entry.deletions;
    }
    return { additions, deletions };
  }, [fileStats, files]);

  const onSelectFileRef = useRef(onSelectFile);
  const selectedFilePathRef = useRef(selectedFilePath);
  const fileSetRef = useRef(fileSet);

  useEffect(() => {
    onSelectFileRef.current = onSelectFile;
  }, [onSelectFile]);

  useEffect(() => {
    selectedFilePathRef.current = selectedFilePath;
  }, [selectedFilePath]);

  useEffect(() => {
    fileSetRef.current = fileSet;
  }, [fileSet]);

  const handleSelectionChange = useCallback(
    (selectedPaths: readonly string[]) => {
      const selectedFile = [...selectedPaths]
        .reverse()
        .find((path) => fileSetRef.current.has(path));

      if (!selectedFile) return;
      if (selectedFile === selectedFilePathRef.current) return;

      onSelectFileRef.current?.(selectedFile);
    },
    [],
  );

  const treeOptions = useMemo(
    () => ({
      id: "icon-set-tree",
      flattenEmptyDirectories: true,
      gitStatus,
    }),
    [gitStatus],
  );

  const fileTreeStyle = useMemo(
    () => ({
      height: "100%",
      colorScheme: (isDark ? "dark" : "light") as "dark" | "light",
      "--trees-bg-override": isDark ? "#18181b" : "#F7F7F3",
      "--trees-bg-muted-override": isDark ? "#27272a" : "#E6E4DD",
      "--trees-selected-bg-override": isDark ? "#27272a" : "#E6E4DD",
    }),
    [isDark],
  );

  return (
    <section
      className={
        showContainer
          ? "flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border"
          : "flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
      }
    >
      <div className="sticky top-0 z-10 shrink-0 border-b border-ink-200 bg-surface px-3 py-2 text-xs text-ink-500 flex justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm text-ink-900">
            {chapterContext?.title ?? "Changed files"}{" "}
            <span className="ml-2 text-ink-500">{files.length}</span>
          </p>
          {chapterContext?.detail ? (
            <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-ink-500">
              {chapterContext.detail}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2 font-mono font-bold">
          {totals ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="text-emerald-600 dark:text-emerald-300">
                +{formatCount(totals.additions)}
              </span>
              <span className="text-red-500 dark:text-red-300">
                -{formatCount(totals.deletions)}
              </span>
            </span>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto scrollbar-hidden">
        {!hasSelection ? (
          <div className="flex h-full min-h-[220px] items-center justify-center px-4 text-center text-sm text-ink-500">
            Select a pull request to load changed files.
          </div>
        ) : null}

        {hasSelection && isLoading ? (
          <div className="flex h-full min-h-[220px] items-center justify-center px-4 text-center text-sm text-ink-500">
            Loading file tree...
          </div>
        ) : null}

        {hasSelection && !isLoading && error ? (
          <div className="flex h-full min-h-[220px] items-center justify-center px-4 text-center text-sm text-danger-600">
            {error}
          </div>
        ) : null}

        {hasSelection && !isLoading && !error && files.length === 0 ? (
          <div className="flex h-full min-h-[220px] items-center justify-center px-4 text-center text-sm text-ink-500">
            No changed files found for this pull request.
          </div>
        ) : null}

        {hasSelection && !isLoading && !error && files.length > 0 ? (
          <FileTree
            className="h-full min-h-[220px]"
            files={files}
            initialExpandedItems={initialExpandedItems}
            selectedItems={selectedTreeFilePath ? [selectedTreeFilePath] : []}
            onSelectedItemsChange={handleSelectionChange}
            style={fileTreeStyle}
            options={treeOptions}
          />
        ) : null}
      </div>
    </section>
  );
}

export { ChangedFilesTree };
export type { ChangedFilesTreeProps };
