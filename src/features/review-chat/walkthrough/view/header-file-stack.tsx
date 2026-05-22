import { PlusIcon } from "@heroicons/react/20/solid";
import type {
  FileStatsEntry,
  ReviewWalkthroughFile,
} from "../../../../types/github";
import { FileStatsBadge } from "./file-stats-badge";
import { getFileBadgeClassName } from "./file-badge-style";
import { fileCountLabel } from "./stats";

const HEADER_STACK_VISIBLE_FILES = 1;

function ReviewWalkthroughHeaderFileStack({
  fileStatsByPath,
  files,
  onSelectFile,
}: {
  fileStatsByPath?: Map<string, FileStatsEntry> | null;
  files: ReviewWalkthroughFile[];
  onSelectFile?: (path: string) => void;
}) {
  const visibleFiles = files.slice(0, HEADER_STACK_VISIBLE_FILES);
  const hiddenCount = Math.max(0, files.length - visibleFiles.length);
  const canSelect = Boolean(onSelectFile);

  return (
    <span
      aria-label={`${fileCountLabel(files.length)} in this review step`}
      className="flex min-w-0 items-center overflow-hidden gap-1"
    >
      {visibleFiles.map((file, index) => {
        const className = getFileBadgeClassName({
          canSelect,
          widthClassName: "max-w-sm",
        });
        const style = { zIndex: visibleFiles.length - index };

        if (canSelect) {
          return (
            <button
              className={className}
              key={file.path}
              onClick={() => onSelectFile?.(file.path)}
              style={style}
              title={file.path}
              type="button"
            >
              <FileStatsBadge
                file={file}
                fileStatsByPath={fileStatsByPath}
                isInteractive
              />
            </button>
          );
        }

        return (
          <span
            className={className}
            key={file.path}
            style={style}
            title={file.path}
          >
            <FileStatsBadge file={file} fileStatsByPath={fileStatsByPath} />
          </span>
        );
      })}
      {hiddenCount > 0 ? (
        <span
          className="inline-flex shrink-0 items-center justify-center gap-0.5 rounded-full border border-ink-200 bg-surface px-2 pl-1 py-1 text-xs font-medium shadow-sm shadow-black/10 dark:border-ink-300 dark:bg-ink-200"
          style={{ zIndex: visibleFiles.length + 1 }}
        >
          <PlusIcon aria-hidden="true" className="size-4" />
          {hiddenCount}
        </span>
      ) : null}
    </span>
  );
}

export { ReviewWalkthroughHeaderFileStack };
