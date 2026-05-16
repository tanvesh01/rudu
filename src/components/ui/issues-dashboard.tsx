import {
  ChatBubbleLeftIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
} from "@heroicons/react/20/solid";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  getGithubUserAvatarUrl,
  getOwnerAvatarUrl,
} from "../../lib/github-owner";
import type { IssueBuckets, IssueSummary } from "../../types/github";

type IssuesDashboardProps = {
  buckets: IssueBuckets | undefined;
  error: unknown;
  isLoading: boolean;
};

type IssueBucketConfig = {
  key: keyof IssueBuckets;
  title: string;
  emptyMessage: string;
};

type IssueStatusViewModel = {
  label: string;
  className: string;
  icon: "open" | "closed";
};

const ISSUE_BUCKETS: IssueBucketConfig[] = [
  {
    key: "assigned",
    title: "Assigned",
    emptyMessage: "No open issues assigned to you.",
  },
  {
    key: "mentioned",
    title: "Mentioned",
    emptyMessage: "No open issues mention you.",
  },
  {
    key: "authored",
    title: "Authored",
    emptyMessage: "No open issues authored by you.",
  },
];

const EMPTY_BUCKETS: IssueBuckets = {
  assigned: [],
  mentioned: [],
  authored: [],
};

const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

function getIssueStatus(issue: IssueSummary): IssueStatusViewModel {
  if (issue.state.toLowerCase() === "closed") {
    return {
      label: "Closed",
      className:
        "border-[#BFE1CC] bg-[#EAF6EF] text-[#1C6B3A] dark:border-green-900/30 dark:bg-green-950/40 dark:text-green-300",
      icon: "closed",
    };
  }

  return {
    label: "Open",
    className:
      "border-[#BFE1CC] bg-[#EAF6EF] text-[#1C6B3A] dark:border-green-900/30 dark:bg-green-950/40 dark:text-green-300",
    icon: "open",
  };
}

function formatRelativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return value;

  const diffSeconds = Math.round((timestamp - Date.now()) / 1000);
  const absSeconds = Math.abs(diffSeconds);
  if (absSeconds < 60) return relativeTimeFormatter.format(diffSeconds, "second");

  const diffMinutes = Math.round(diffSeconds / 60);
  const absMinutes = Math.abs(diffMinutes);
  if (absMinutes < 60) return relativeTimeFormatter.format(diffMinutes, "minute");

  const diffHours = Math.round(diffMinutes / 60);
  const absHours = Math.abs(diffHours);
  if (absHours < 24) return relativeTimeFormatter.format(diffHours, "hour");

  const diffDays = Math.round(diffHours / 24);
  const absDays = Math.abs(diffDays);
  if (absDays < 30) return relativeTimeFormatter.format(diffDays, "day");

  const diffMonths = Math.round(diffDays / 30);
  const absMonths = Math.abs(diffMonths);
  if (absMonths < 12) return relativeTimeFormatter.format(diffMonths, "month");

  return relativeTimeFormatter.format(Math.round(diffMonths / 12), "year");
}

function getErrorMessage(error: unknown) {
  if (!error) return "";
  if (error instanceof Error) return error.message;
  return String(error);
}

function IssueStatusIcon({ issue }: { issue: IssueSummary }) {
  const status = getIssueStatus(issue);
  const className = "size-4 shrink-0";

  if (status.icon === "closed") {
    return <CheckCircleIcon aria-label={status.label} className={className} />;
  }

  return <ExclamationCircleIcon aria-label={status.label} className={className} />;
}

function IssueRow({ issue }: { issue: IssueSummary }) {
  const status = getIssueStatus(issue);
  const updatedLabel = formatRelativeTime(issue.updatedAt);

  return (
    <button
      className="group flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition hover:bg-canvasDark focus-visible:bg-canvasDark focus-visible:outline-none"
      onClick={() => void openUrl(issue.url)}
      type="button"
    >
      <span
        className={[
          "mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border",
          status.className,
        ].join(" ")}
      >
        <IssueStatusIcon issue={issue} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-start gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink-800">
            {issue.title}
          </p>
          {issue.commentCount > 0 ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-xs text-ink-500">
              <ChatBubbleLeftIcon className="size-3.5" />
              {issue.commentCount}
            </span>
          ) : null}
        </div>

        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <img
              alt=""
              className="size-4 shrink-0 rounded-full object-cover"
              loading="lazy"
              src={getOwnerAvatarUrl(issue.repo, 32)}
            />
            <span className="min-w-0 truncate font-mono">
              {issue.repo}#{issue.number}
            </span>
          </span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <img
              alt=""
              className="size-4 shrink-0 rounded-full object-cover"
              loading="lazy"
              src={getGithubUserAvatarUrl(issue.authorLogin, 32)}
            />
            <span className="truncate">{issue.authorLogin}</span>
          </span>
          <span aria-hidden="true">·</span>
          <span title={issue.updatedAt}>Updated {updatedLabel}</span>
        </div>
      </div>
    </button>
  );
}

function IssueBucketSection({
  emptyMessage,
  issues,
  title,
}: {
  emptyMessage: string;
  issues: IssueSummary[];
  title: string;
}) {
  return (
    <section className="border-t border-ink-200">
      <div className="flex items-center justify-between px-5 py-3">
        <h2 className="text-sm font-semibold text-ink-800">{title}</h2>
        <span className="rounded-full bg-canvasDark px-2 py-0.5 text-xs font-medium text-ink-500">
          {issues.length}
        </span>
      </div>

      <div className="px-2 pb-3">
        {issues.length === 0 ? (
          <div className="px-3 py-4 text-sm text-ink-500">{emptyMessage}</div>
        ) : (
          <div className="flex flex-col">
            {issues.map((issue) => (
              <IssueRow
                issue={issue}
                key={`${issue.repo}#${issue.number}-${issue.url}`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function IssuesDashboard({ buckets, error, isLoading }: IssuesDashboardProps) {
  const issueBuckets = buckets ?? EMPTY_BUCKETS;

  return (
    <main className="flex h-full min-h-0 flex-col bg-canvas text-ink-900">
      <div className="shrink-0 border-b border-ink-200 px-5 py-4">
        <h1 className="text-base font-semibold text-ink-900">Issues</h1>
        <p className="mt-1 text-sm text-ink-500">
          Open issues where you are assigned, mentioned, or the author.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <div className="px-5 py-4 text-sm text-danger-600">
            {getErrorMessage(error)}
          </div>
        ) : null}

        {!error && isLoading ? (
          <div className="px-5 py-4 text-sm text-ink-500">Loading issues...</div>
        ) : null}

        {!error && !isLoading
          ? ISSUE_BUCKETS.map((bucket) => (
              <IssueBucketSection
                emptyMessage={bucket.emptyMessage}
                issues={issueBuckets[bucket.key]}
                key={bucket.key}
                title={bucket.title}
              />
            ))
          : null}
      </div>
    </main>
  );
}

export { IssuesDashboard, getIssueStatus };
export type { IssuesDashboardProps, IssueStatusViewModel };
