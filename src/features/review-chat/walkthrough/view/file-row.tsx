import type {
  FileStatsEntry,
  ReviewWalkthroughFile,
} from "../../../../types/github";
import { FileStatsBadge } from "./file-stats-badge";
import { getFileBadgeClassName } from "./file-badge-style";

function ReviewWalkthroughFileRow({
  fileStatsByPath,
  file,
  onSelectFile,
}: {
  fileStatsByPath?: Map<string, FileStatsEntry> | null;
  file: ReviewWalkthroughFile;
  onSelectFile?: (path: string) => void;
}) {
  const canSelect = Boolean(onSelectFile);

  return (
    <li className="rounded-md shadow-sm shadow-black/5">
      <div className="min-w-0 flex-wrap items-center gap-1.5 mb-3">
        <button
          className={getFileBadgeClassName({
            canSelect,
            widthClassName: "max-w-full",
          })}
          disabled={!canSelect}
          onClick={() => onSelectFile?.(file.path)}
          title={file.path}
          type="button"
        >
          <FileStatsBadge
            file={file}
            fileStatsByPath={fileStatsByPath}
            isInteractive={canSelect}
          />
        </button>
      </div>
      <p className="mb-2 text-sm leading-5 text-ink-700">{file.reason}</p>
      <p className="text-xs text-ink-500">{file.context}</p>
    </li>
  );
}

export { ReviewWalkthroughFileRow };
