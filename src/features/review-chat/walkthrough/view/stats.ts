import type {
  FileStatsEntry,
  ReviewWalkthroughFile,
} from "../../../../types/github";
import { normalizePath } from "../../../../lib/review-threads";

type LineChangeStats = {
  additions: number;
  deletions: number;
};

function fileName(path: string) {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function fileCountLabel(count: number) {
  return count === 1 ? "1 file" : `${count} files`;
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

function formatLineStats(stats: LineChangeStats) {
  return {
    additions: `+${formatCount(stats.additions)}`,
    deletions: `-${formatCount(stats.deletions)}`,
  };
}

function getWalkthroughFileLineStats(
  fileStatsByPath: Map<string, FileStatsEntry> | null | undefined,
  path: string,
): LineChangeStats | null {
  const stats =
    fileStatsByPath?.get(path) ?? fileStatsByPath?.get(normalizePath(path));

  if (!stats) return null;

  return {
    additions: stats.additions,
    deletions: stats.deletions,
  };
}

function getWalkthroughGroupLineStats(
  fileStatsByPath: Map<string, FileStatsEntry> | null | undefined,
  files: ReviewWalkthroughFile[],
): LineChangeStats | null {
  let additions = 0;
  let deletions = 0;

  for (const file of files) {
    const stats = getWalkthroughFileLineStats(fileStatsByPath, file.path);
    if (!stats) return null;

    additions += stats.additions;
    deletions += stats.deletions;
  }

  return { additions, deletions };
}

export {
  fileCountLabel,
  fileName,
  formatLineStats,
  getWalkthroughFileLineStats,
  getWalkthroughGroupLineStats,
};
export type { LineChangeStats };
