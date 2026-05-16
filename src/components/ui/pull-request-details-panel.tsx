import { ArrowPathIcon } from "@heroicons/react/16/solid";
import { useEffect, useRef, useState } from "react";
import { PullRequestMarkdown } from "./pull-request-markdown";
import { Tooltip, TooltipProvider } from "./tooltip";
import type {
  PullRequestCheck,
  PullRequestChecks,
  PullRequestCheckStatus,
  PullRequestOverview,
} from "../../types/github";

type PullRequestDetailsPanelProps = {
  overview: PullRequestOverview | null;
  checks: PullRequestChecks | null;
  isOverviewLoading: boolean;
  isChecksLoading: boolean;
  isChecksRefreshing: boolean;
  overviewError: string;
  checksError: string;
  onRefreshChecks: () => void;
};

type StatusView = {
  label: string;
  className: string;
};

const relativeTimeFormatter = new Intl.RelativeTimeFormat("en", {
  numeric: "always",
  style: "narrow",
});

function getStatusView(status: PullRequestCheckStatus): StatusView {
  switch (status) {
    case "pass":
      return {
        label: "Passed",
        className:
          "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300",
      };
    case "fail":
      return {
        label: "Failed",
        className:
          "border-red-200 bg-red-50 text-danger-600 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300",
      };
    case "pending":
      return {
        label: "Pending",
        className:
          "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-300",
      };
    case "skipped":
      return {
        label: "Skipped",
        className: "border-ink-200 bg-canvas text-ink-600",
      };
    case "cancelled":
      return {
        label: "Cancelled",
        className: "border-ink-200 bg-canvas text-ink-600",
      };
    case "neutral":
      return {
        label: "Neutral",
        className: "border-ink-200 bg-canvas text-ink-600",
      };
    case "unknown":
    default:
      return {
        label: "Unknown",
        className: "border-ink-200 bg-canvas text-ink-600",
      };
  }
}

function ChecksRefreshButton({
  isRefreshing,
  onRefresh,
}: {
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <Tooltip content="Refetch checks from GitHub">
      <button
        aria-label="Refetch checks from GitHub"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-500 disabled:cursor-wait disabled:opacity-80"
        disabled={isRefreshing}
        onClick={onRefresh}
        type="button"
      >
        <ArrowPathIcon
          className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`}
        />
      </button>
    </Tooltip>
  );
}

function getStatusStripColor(status: PullRequestCheckStatus) {
  switch (status) {
    case "pass":
      return "bg-[rgba(26,236,166,1)]";
    case "fail":
      return "bg-[rgba(252,50,50,1)]";
    case "pending":
      return "bg-amber-500";
    case "skipped":
    case "cancelled":
    case "neutral":
      return "bg-ink-400 dark:bg-ink-300";
    case "unknown":
    default:
      return "bg-ink-500 dark:bg-ink-400";
  }
}

function getBalancedColumnCount(itemCount: number, width: number) {
  if (itemCount <= 0) {
    return 1;
  }

  const minSegmentWidth = 5;
  const gapWidth = 2;
  const maxColumns = Math.max(
    1,
    Math.floor((width + gapWidth) / (minSegmentWidth + gapWidth)),
  );

  if (maxColumns >= itemCount) {
    return itemCount;
  }

  for (let columns = maxColumns; columns > 1; columns -= 1) {
    if (itemCount % columns === 0) {
      return columns;
    }
  }

  let bestColumns = maxColumns;
  let smallestRaggedGap = itemCount;

  for (let columns = maxColumns; columns > 1; columns -= 1) {
    const lastRowCount = itemCount % columns || columns;
    const raggedGap = columns - lastRowCount;

    if (raggedGap < smallestRaggedGap) {
      bestColumns = columns;
      smallestRaggedGap = raggedGap;
    }
  }

  return bestColumns;
}

function formatCompactDuration(startedAt: string, completedAt: string) {
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }

  const seconds = Math.max(1, Math.round((end - start) / 1000));

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.round(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.round(minutes / 60);

  if (hours < 24) {
    return `${hours}h`;
  }

  return `${Math.round(hours / 24)}d`;
}

function formatRelativeAge(timestamp: string) {
  const time = new Date(timestamp).getTime();

  if (!Number.isFinite(time)) {
    return null;
  }

  const elapsedMs = Date.now() - time;

  if (elapsedMs < 0) {
    return null;
  }

  const seconds = Math.max(1, Math.round(elapsedMs / 1000));

  if (seconds < 60) {
    return relativeTimeFormatter.format(-seconds, "second");
  }

  const minutes = Math.round(seconds / 60);

  if (minutes < 60) {
    return relativeTimeFormatter.format(-minutes, "minute");
  }

  const hours = Math.round(minutes / 60);

  if (hours < 24) {
    return relativeTimeFormatter.format(-hours, "hour");
  }

  return relativeTimeFormatter.format(-Math.round(hours / 24), "day");
}

function getFailedCheckTimingText(check: PullRequestCheck) {
  if (check.startedAt && check.completedAt) {
    const duration = formatCompactDuration(check.startedAt, check.completedAt);

    if (duration) {
      return `Failing after ${duration}`;
    }
  }

  if (check.createdAt) {
    const age = formatRelativeAge(check.createdAt);

    if (age) {
      return `Failed ${age}`;
    }
  }

  return "Failed";
}

function ChecksStatusStrip({
  checks,
}: {
  checks: PullRequestChecks["checks"];
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [columnCount, setColumnCount] = useState(checks.length);

  useEffect(() => {
    const strip = stripRef.current;

    if (!strip) {
      return;
    }

    const updateColumnCount = () => {
      setColumnCount(getBalancedColumnCount(checks.length, strip.clientWidth));
    };

    updateColumnCount();

    const resizeObserver = new ResizeObserver(updateColumnCount);
    resizeObserver.observe(strip);

    return () => resizeObserver.disconnect();
  }, [checks.length]);

  return (
    <TooltipProvider>
      <div
        aria-label={`${checks.length} check status overview`}
        className="mb-3 grid gap-[2px]"
        ref={stripRef}
        style={{
          gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
        }}
      >
        {checks.map((check, index) => {
          const statusLabel = getStatusView(check.status).label;

          return (
            <Tooltip
              content={`${check.title}: ${statusLabel}`}
              key={`${check.order}-${check.title}`}
            >
              <button
                aria-label={`Check ${index + 1}: ${check.title}, ${statusLabel}`}
                className={`h-[20px] min-w-0 appearance-none border-0 p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-500 ${getStatusStripColor(
                  check.status,
                )}`}
                type="button"
              />
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

function FailedChecksList({ checks }: { checks: PullRequestCheck[] }) {
  if (checks.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 py-3 font-mono text-xs">
      <div className="flex min-w-0 items-center gap-2 whitespace-nowrap">
        <span className="font-sans text-ink-500">
          {checks.length} failing {checks.length === 1 ? "check" : "checks"}
        </span>
      </div>
      <div className="mt-1 space-y-0.5">
        {checks.map((check) => (
          <p
            className="flex min-w-0 items-center gap-2 whitespace-nowrap"
            key={`${check.order}-${check.title}`}
          >
            <span className="min-w-0 truncate font-semibold text-ink-800">
              {check.title}
            </span>
            <span className="shrink-0 text-ink-400">·</span>
            <span className="shrink-0 text-red-500 dark:text-red-400">
              {getFailedCheckTimingText(check)}
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}

function PullRequestDetailsPanel({
  overview,
  checks,
  isOverviewLoading,
  isChecksLoading,
  isChecksRefreshing,
  overviewError,
  checksError,
  onRefreshChecks,
}: PullRequestDetailsPanelProps) {
  const failedChecks =
    checks?.checks.filter((check) => check.status === "fail") ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto scrollbar-hidden bg-surface">
      <div className="shrink-0 px-3 py-3">
        {isOverviewLoading ? (
          <p className="text-sm text-ink-500">Loading pull request...</p>
        ) : null}

        {!isOverviewLoading && overviewError ? (
          <p className="text-sm text-danger-600">{overviewError}</p>
        ) : null}

        {!isOverviewLoading && !overviewError && overview ? (
          <div className="min-w-0">
            <div className="flex min-w-0 items-start gap-2">
              <h2 className="min-w-0 flex-1 text-sm font-medium leading-5 text-ink-900">
                {overview.title}
              </h2>
            </div>
            <p className="mt-1 text-xs text-ink-500">
              #{overview.number} by {overview.authorLogin}
            </p>
          </div>
        ) : null}
      </div>

      <div className="shrink-0 px-3">
        <div className="mb-1 flex items-center">
          <p className="text-xs font-medium text-ink-500">Checks</p>
          {checks ? (
            <ChecksRefreshButton
              isRefreshing={isChecksRefreshing}
              onRefresh={onRefreshChecks}
            />
          ) : null}
        </div>

        {isChecksLoading && !checks ? (
          <p className="text-sm text-ink-500">Loading checks...</p>
        ) : null}

        {checksError ? (
          <p className="text-sm text-danger-600">{checksError}</p>
        ) : null}

        {!isChecksLoading && !checksError && checks?.checks.length === 0 ? (
          <p className="text-sm text-ink-500">No checks found for this PR.</p>
        ) : null}

        {checks && checks.checks.length > 0 ? (
          <>
            <ChecksStatusStrip checks={checks.checks} />
            <FailedChecksList checks={failedChecks} />
          </>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 px-3 pb-6 pt-1">
        <p className="pb-1 text-xs font-medium text-ink-600">Description</p>
        {overview?.body.trim() ? (
          <PullRequestMarkdown body={overview.body} />
        ) : (
          <p className="text-sm text-ink-500">No description provided.</p>
        )}
      </div>
    </div>
  );
}

export { PullRequestDetailsPanel };
export type { PullRequestDetailsPanelProps };
