import {
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
  ChatBubbleLeftIcon,
  InboxIcon,
  PlusCircleIcon,
} from "@heroicons/react/20/solid";
import type { ComponentType, SVGProps } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  getGithubUserAvatarUrl,
  getOwnerAvatarUrl,
} from "@/lib/github-owner";
import type { IssueBuckets, IssueSummary } from "@/types/github";

type IssueBucketConfig = {
  key: keyof IssueBuckets;
  title: string;
  emptyMessage: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
};

const ISSUE_BUCKETS: IssueBucketConfig[] = [
  {
    key: "inProgress",
    title: "In Progress",
    emptyMessage: "No open issues with attached PRs.",
    Icon: ArrowPathIcon,
  },
  {
    key: "assigned",
    title: "Assigned",
    emptyMessage: "No open issues assigned to you.",
    Icon: InboxIcon,
  },
  {
    key: "mentioned",
    title: "Mentioned",
    emptyMessage: "No open issues mention you.",
    Icon: ChatBubbleLeftRightIcon,
  },
  {
    key: "authored",
    title: "Authored",
    emptyMessage: "No open issues authored by you.",
    Icon: PlusCircleIcon,
  },
];

const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

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

function IssueRow({ issue }: { issue: IssueSummary }) {
  const updatedLabel = formatRelativeTime(issue.updatedAt);

  return (
    <button
      className="group flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition hover:bg-canvasDark focus-visible:bg-canvasDark focus-visible:outline-none"
      onClick={() => void openUrl(issue.url)}
      type="button"
    >
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
  Icon,
  title,
}: {
  emptyMessage: string;
  issues: IssueSummary[];
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
}) {
  return (
    <section className="border-t border-ink-200">
      <div className="flex items-center justify-between px-5 py-3">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink-800">
          <Icon aria-hidden="true" className="size-4 shrink-0 text-ink-500" />
          <span>{title}</span>
        </h2>
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

export { ISSUE_BUCKETS, IssueBucketSection };
export type { IssueBucketConfig };
