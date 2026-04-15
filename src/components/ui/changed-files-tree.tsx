import { useCallback, useMemo } from "react";
import type { GitStatusEntry } from "@pierre/trees";
import { FileTree } from "@pierre/trees/react";
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
};

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

const CUSTOM_FILE_ICON_SPRITE = `<svg data-icon-sprite aria-hidden="true" width="0" height="0">
  <symbol id="file-tree-icon-custom-document" viewBox="0 0 24 24">
    <path fill="currentColor" d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0 0 16.5 9h-1.875a1.875 1.875 0 0 1-1.875-1.875V5.25A3.75 3.75 0 0 0 9 1.5H5.625Z" />
    <path fill="currentColor" d="M12.971 1.816A5.23 5.23 0 0 1 14.25 5.25v1.875c0 .207.168.375.375.375H16.5a5.23 5.23 0 0 1 3.434 1.279 9.768 9.768 0 0 0-6.963-6.963Z" />
  </symbol>
</svg>`;

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
      id: "icon-set-tree",
      icons: {
        set: "standard",
        colored: true,
        spriteSheet: CUSTOM_FILE_ICON_SPRITE,
        remap: {
          "file-tree-icon-file": {
            name: "file-tree-icon-custom-document",
            width: 16,
            height: 16,
            viewBox: "0 0 24 24",
          },
        },
      },
      flattenEmptyDirectories: true,
      useLazyDataLoader: true,
      unsafeCSS: `
        [data-type='item'][data-item-type='file']
          > [data-item-section='icon']
          > [data-icon-name='file-tree-icon-file'] {
          color: #cbc6b5 !important;
          filter: none;
        }

        [data-type='item'][data-item-contains-git-change='true'] {
          color: #171717 !important;
        }

        [data-type='item'][data-item-contains-git-change='true'] > [data-item-section='status'] {
          color: #737373 !important;
        }

        [data-type='item'][data-item-git-status='modified']
          > [data-item-section='icon']
          > :not([data-icon-name='file-tree-icon-chevron']):not([data-icon-name='file-tree-icon-file']) {
          color: #171717 !important;
        }

        [data-type='item'][data-item-git-status='modified'] > [data-item-section='content'] {
          color: #424242 !important;
        }

        [data-type='item'][data-item-git-status='modified'] > [data-item-section='status'] {
          color: #ca8a04 !important;
        }

        [data-type='item'][data-item-selected='true'] > [data-item-section='content'] {
          color: #000000 !important;
        }
      `,
    }),
    [],
  );

  const fileTreeStyle = useMemo(
    () => ({
      height: "100%",
      "--trees-fg-override": "#171717",
      "--trees-bg-muted": "#e8e8e8",
      "--trees-fg-muted-override": "#525252",
      "--trees-bg-muted-override": "#f5f5f5",
      "--trees-selected-fg-override": "#000000",
      "--trees-selected-bg-override": "#e8e8e8",
      "--trees-selected-focused-border-color-override": "transparent",
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
      <div className="sticky top-0 z-10 shrink-0 border-b border-ink-200 bg-surface px-3 py-2 text-xs text-neutral-500">
        <p className="text-sm text-neutral-800">
          Changed files{" "}
          <span className="text-neutral-500 ml-2">{files.length}</span>
        </p>
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
