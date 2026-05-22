import { formatLineStats, type LineChangeStats } from "./stats";

function LineStatsText({ stats }: { stats: LineChangeStats }) {
  const formatted = formatLineStats(stats);

  return (
    <span className="inline-flex shrink-0 items-center gap-1 font-mono text-xs">
      <span className="text-emerald-600 dark:text-emerald-300">
        {formatted.additions}
      </span>
      <span className="text-red-500 dark:text-red-300">
        {formatted.deletions}
      </span>
    </span>
  );
}

export { LineStatsText };
