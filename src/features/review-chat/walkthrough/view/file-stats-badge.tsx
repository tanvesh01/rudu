import type {
  FileStatsEntry,
  ReviewWalkthroughFile,
} from "../../../../types/github";
import { LineStatsText } from "./line-stats-text";
import { fileName, getWalkthroughFileLineStats } from "./stats";

function FileStatsBadge({
  file,
  fileStatsByPath,
  isInteractive = false,
}: {
  file: ReviewWalkthroughFile;
  fileStatsByPath?: Map<string, FileStatsEntry> | null;
  isInteractive?: boolean;
}) {
  const stats = getWalkthroughFileLineStats(fileStatsByPath, file.path);

  return (
    <>
      <span className="min-w-0 truncate font-mono">{fileName(file.path)}</span>
      {stats ? <LineStatsText stats={stats} /> : null}
      {isInteractive ? <span className="sr-only">Open file</span> : null}
    </>
  );
}

export { FileStatsBadge };
