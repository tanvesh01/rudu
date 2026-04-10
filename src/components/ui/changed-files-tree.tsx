import { useCallback, useMemo } from "react";
import { ChevronDoubleLeftIcon } from "@heroicons/react/24/outline";
import type { GitStatusEntry } from "@pierre/trees";
import { FileTree } from "@pierre/trees/react";
import type { FileStatsEntry } from "../../App";

type ChangedFilesTreeProps = {
  files: string[];
  isLoading: boolean;
  error: string;
  hasSelection: boolean;
  showContainer?: boolean;
  onHideTree?: () => void;
  onSelectFile?: (path: string) => void;
  selectedFilePath?: string | null;
  fileStats: Map<string, FileStatsEntry> | null;
  gitStatus: GitStatusEntry[] | undefined;
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
  onHideTree,
  onSelectFile,
  selectedFilePath,
  fileStats,
  gitStatus,
}: ChangedFilesTreeProps) {
  const initialExpandedItems = useMemo(() => {
    const topLevelDirs = files
      .map((file) => {
        const slashIndex = file.indexOf("/");
        return slashIndex > 0 ? file.slice(0, slashIndex) : null;
      })
      .filter((value): value is string => value !== null);

    return Array.from(new Set(topLevelDirs)).slice(0, 8);
  }, [files]);

  const totals = useMemo(() => {
    if (!fileStats) return null;
    let additions = 0;
    let deletions = 0;
    for (const entry of fileStats.values()) {
      additions += entry.additions;
      deletions += entry.deletions;
    }
    return { additions, deletions };
  }, [fileStats]);

  const fileTreeOptions = useMemo(
    () => ({
      flattenEmptyDirectories: true,
      useLazyDataLoader: true,
    }),
    [],
  );

  const handleSelection = useCallback(
    (items: Array<{ path: string; isFolder: boolean }>) => {
      if (!onSelectFile) return;

      const selectedFile = [...items].reverse().find((item) => !item.isFolder);
      if (selectedFile) {
        onSelectFile(selectedFile.path);
      }
    },
    [onSelectFile],
  );

  return (
    <section
      className={
        showContainer
          ? "flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border"
          : "flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
      }
    >
      <div className="flex items-center justify-between border-b border-ink-200 px-3 py-2 text-xs text-ink-600">
        <div className="flex items-center gap-2">
          <strong className="text-sm text-ink-900">Changed files</strong>
          {onHideTree ? (
            <button
              aria-label="Hide changed files"
              className="inline-flex h-7 items-center gap-1 rounded-md border border-ink-200 px-2 text-xs text-ink-600 transition hover:bg-canvas hover:text-ink-900"
              onClick={onHideTree}
              type="button"
            >
              <ChevronDoubleLeftIcon className="size-3.5" />
              Hide
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {totals ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="text-emerald-600">
                +{formatCount(totals.additions)}
              </span>
              <span className="text-red-500">
                −{formatCount(totals.deletions)}
              </span>
            </span>
          ) : null}
          <span>{files.length}</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
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
            className="h-full min-h-[220px] bg-surface"
            files={files}
            gitStatus={gitStatus}
            initialExpandedItems={initialExpandedItems}
            onSelection={onSelectFile ? handleSelection : undefined}
            options={fileTreeOptions}
            selectedItems={selectedFilePath ? [selectedFilePath] : undefined}
            style={{ height: "100%" }}
          />
        ) : null}
      </div>
    </section>
  );
}

export { ChangedFilesTree };
export type { ChangedFilesTreeProps };
