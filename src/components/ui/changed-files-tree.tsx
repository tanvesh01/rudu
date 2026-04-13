import { useCallback, useMemo } from "react";
import type { GitStatusEntry } from "@pierre/trees";
import { FileTree } from "@pierre/trees/react";
import type { FileStatsEntry } from "../../App";

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
      unsafeCSS: `
        [data-type='item'][data-item-contains-git-change='true'] {
          color: #171717 !important;
        }

        [data-type='item'][data-item-contains-git-change='true'] > [data-item-section='status'] {
          color: #737373 !important;
        }

        [data-type='item'][data-item-git-status='modified']
          > [data-item-section='icon']
          > :not([data-icon-name='file-tree-icon-chevron']) {
          color: #171717 !important;
        }

        [data-type='item'][data-item-git-status='modified'] > [data-item-section='content'] {
          color: #171717 !important;
        }

        [data-type='item'][data-item-git-status='modified'] > [data-item-section='status'] {
          color: #ca8a04 !important;
        }
      `,
    }),
    [],
  );

  const fileTreeStyle = useMemo(
    () => ({
      height: "100%",
      "--trees-fg-override": "#171717",
      "--trees-fg-muted-override": "#525252",
      "--trees-bg-muted-override": "#f5f5f5",
      "--trees-selected-fg-override": "#171717",
      "--trees-selected-bg-override": "#e5e5e5",
      "--trees-selected-focused-border-color-override": "#737373",
      "--trees-focus-ring-color-override": "#737373",
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
        <p className="text-sm text-neutral-500">Changed files</p>
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
            style={fileTreeStyle}
          />
        ) : null}
      </div>
    </section>
  );
}

export { ChangedFilesTree };
export type { ChangedFilesTreeProps };
