import {
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
  ChatBubbleLeftIcon,
  InboxIcon,
  PlusCircleIcon,
} from "@heroicons/react/20/solid";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import githubLogoUrl from "@/assets/provider-logos/github-invertocat-white.svg";
import linearLogoUrl from "@/assets/provider-logos/linear-light-logo.svg";
import { getGithubUserAvatarUrl } from "@/lib/github-owner";
import type {
  IssueBuckets,
  IssueLinkedPullRequest,
  IssueProvider,
  IssueSummary,
} from "@/types/issues";

type IssueBucketConfig = {
  key: keyof IssueBuckets;
  title: string;
  emptyMessage: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  headerClassName?: string;
  iconClassName?: string;
};

const ISSUE_BUCKETS: IssueBucketConfig[] = [
  {
    key: "inProgress",
    title: "In Progress",
    emptyMessage: "No issues in progress.",
    Icon: ArrowPathIcon,
    iconClassName: "text-yellow-500 dark:text-yellow-300",
  },
  {
    key: "assigned",
    title: "Assigned",
    emptyMessage: "No open issues assigned to you.",
    Icon: InboxIcon,
  },
  {
    key: "subscribed",
    title: "Subscribed",
    emptyMessage: "No subscribed issues.",
    Icon: ChatBubbleLeftRightIcon,
  },
  {
    key: "created",
    title: "Created",
    emptyMessage: "No issues created by you.",
    Icon: PlusCircleIcon,
  },
];

const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

const compactDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

const compactYearDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  year: "numeric",
});

function formatRelativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return value;

  const diffSeconds = Math.round((timestamp - Date.now()) / 1000);
  const absSeconds = Math.abs(diffSeconds);
  if (absSeconds < 60)
    return relativeTimeFormatter.format(diffSeconds, "second");

  const diffMinutes = Math.round(diffSeconds / 60);
  const absMinutes = Math.abs(diffMinutes);
  if (absMinutes < 60)
    return relativeTimeFormatter.format(diffMinutes, "minute");

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

function getIssueIdentityLabel(issue: IssueSummary) {
  if (issue.provider === "github") {
    if (issue.number === null) return null;
    return `#${issue.number}`;
  }

  return issue.key ?? issue.teamName;
}

function getIssueActorLabel(issue: IssueSummary) {
  if (issue.provider === "linear") {
    return issue.assigneeName ?? issue.authorLogin ?? null;
  }

  return issue.authorLogin;
}

function getIssueAvatarUrl(issue: IssueSummary) {
  if (issue.authorAvatarUrl) return issue.authorAvatarUrl;
  if (issue.provider === "github" && issue.authorLogin) {
    return getGithubUserAvatarUrl(issue.authorLogin, 32);
  }

  return null;
}

function formatIssueDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  if (date.getFullYear() === new Date().getFullYear()) {
    return compactDateFormatter.format(date);
  }

  return compactYearDateFormatter.format(date);
}

function IssueTitle({ title }: { title: string }) {
  const parts = title.split(/(`[^`]+`)/g);

  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code
              className="rounded border border-ink-200 bg-surface px-1 py-0.5 font-mono text-[0.92em] text-ink-800"
              key={`${part}-${index}`}
            >
              {part.slice(1, -1)}
            </code>
          );
        }

        return part;
      })}
    </>
  );
}

function IssueProviderBadge({ provider }: { provider: IssueProvider }) {
  if (provider === "linear") {
    return (
      <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-[#828fff] bg-gradient-to-b from-[#828fff] to-[#5f6cf2] px-2 text-xs font-medium text-white shadow-sm">
        <img
          alt=""
          aria-hidden="true"
          className="size-3 shrink-0"
          src={linearLogoUrl}
        />
        Linear
      </span>
    );
  }

  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-ink-100 bg-surface px-2 text-xs font-medium text-ink-600 shadow-sm">
      <span className="inline-flex size-3 shrink-0 items-center justify-center rounded-full bg-ink-900">
        <img
          alt=""
          aria-hidden="true"
          className="size-2 shrink-0 dark:invert"
          src={githubLogoUrl}
        />
      </span>
      GitHub
    </span>
  );
}

function MetadataPill({
  children,
  title,
}: {
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      className="inline-flex h-6 max-w-[14rem] shrink-0 items-center gap-1.5 truncate rounded-full border border-ink-100 bg-surface px-2.5 text-xs text-ink-600"
      title={title}
    >
      <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
        {children}
      </span>
    </span>
  );
}

function LinkedPullRequestPills({
  linkedPullRequests,
  onOpenLinkedPullRequest,
}: {
  linkedPullRequests: IssueLinkedPullRequest[];
  onOpenLinkedPullRequest: (pullRequest: IssueLinkedPullRequest) => void;
}) {
  if (linkedPullRequests.length === 0) return null;

  return (
    <>
      {linkedPullRequests.map((pullRequest) => (
        <button
          aria-label={`Open PR #${pullRequest.number} in Rudu`}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-ink-200 bg-surface px-2.5 text-xs font-medium text-ink-600 transition hover:border-ink-300 hover:bg-canvasDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          key={`${pullRequest.repo}#${pullRequest.number}`}
          onClick={() => onOpenLinkedPullRequest(pullRequest)}
          title={pullRequest.title}
          type="button"
        >
          <span aria-hidden="true" className="text-ink-400">
            PR
          </span>
          #{pullRequest.number}
        </button>
      ))}
    </>
  );
}

function IssueAvatar({
  actorLabel,
  avatarUrl,
}: {
  actorLabel: string | null;
  avatarUrl: string | null;
}) {
  if (!avatarUrl) return null;

  return (
    <img
      alt={actorLabel ? "" : "Issue actor"}
      className="size-4 shrink-0 rounded-full object-cover"
      loading="lazy"
      src={avatarUrl}
      title={actorLabel ?? undefined}
    />
  );
}

function IssueMetadataRail({
  actorLabel,
  avatarUrl,
  issue,
  onOpenLinkedPullRequest,
  updatedLabel,
}: {
  actorLabel: string | null;
  avatarUrl: string | null;
  issue: IssueSummary;
  onOpenLinkedPullRequest: (pullRequest: IssueLinkedPullRequest) => void;
  updatedLabel: string;
}) {
  return (
    <div className="flex min-w-0 shrink-0 items-center justify-end gap-1.5">
      <LinkedPullRequestPills
        linkedPullRequests={issue.linkedPullRequests}
        onOpenLinkedPullRequest={onOpenLinkedPullRequest}
      />
      {issue.commentCount > 0 ? (
        <MetadataPill title={`${issue.commentCount} comments`}>
          <ChatBubbleLeftIcon className="size-3.5 shrink-0 text-ink-400" />
          {issue.commentCount}
        </MetadataPill>
      ) : null}
      <IssueAvatar actorLabel={actorLabel} avatarUrl={avatarUrl} />
      <time
        className="w-16 shrink-0 text-right text-xs font-medium text-ink-500"
        dateTime={issue.updatedAt}
        title={`${updatedLabel} · ${issue.updatedAt}`}
      >
        {formatIssueDate(issue.updatedAt)}
      </time>
    </div>
  );
}

function IssueMainButton({
  issue,
  issueIdentity,
}: {
  issue: IssueSummary;
  issueIdentity: string | null;
}) {
  return (
    <a
      className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none"
      href={issue.url}
      onClick={(event) => {
        event.preventDefault();
        void openUrl(issue.url);
      }}
    >
      {issueIdentity ? (
        <span className="w-20 shrink-0 truncate font-mono text-sm font-medium text-ink-500">
          {issueIdentity}
        </span>
      ) : null}
      <IssueProviderBadge provider={issue.provider} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-800">
        <IssueTitle title={issue.title} />
      </span>
    </a>
  );
}

function IssueRow({
  issue,
  onOpenLinkedPullRequest,
}: {
  issue: IssueSummary;
  onOpenLinkedPullRequest: (pullRequest: IssueLinkedPullRequest) => void;
}) {
  const updatedLabel = formatRelativeTime(issue.updatedAt);
  const issueIdentity = getIssueIdentityLabel(issue);
  const actorLabel = getIssueActorLabel(issue);
  const avatarUrl = getIssueAvatarUrl(issue);

  return (
    <div className="group flex min-h-8 w-full items-center gap-4 rounded-md px-4 py-2 transition hover:bg-canvasDark focus-within:bg-canvasDark">
      <IssueMainButton issue={issue} issueIdentity={issueIdentity} />
      <IssueMetadataRail
        actorLabel={actorLabel}
        avatarUrl={avatarUrl}
        issue={issue}
        onOpenLinkedPullRequest={onOpenLinkedPullRequest}
        updatedLabel={updatedLabel}
      />
    </div>
  );
}

function IssueBucketSection({
  emptyMessage,
  headerClassName = "bg-surface",
  iconClassName = "text-ink-500",
  issues,
  Icon,
  onOpenLinkedPullRequest,
  title,
}: {
  emptyMessage: string;
  headerClassName?: string;
  iconClassName?: string;
  issues: IssueSummary[];
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  onOpenLinkedPullRequest: (pullRequest: IssueLinkedPullRequest) => void;
  title: string;
}) {
  return (
    <section className="space-y-2 py-2">
      <div
        className={[
          "flex items-center gap-2 rounded-md px-4 py-3",
          headerClassName,
        ].join(" ")}
      >
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink-800">
          <Icon
            aria-hidden="true"
            className={["size-4 shrink-0", iconClassName].join(" ")}
          />
          <span>{title}</span>
        </h2>
        <span className="text-sm font-semibold text-ink-500">
          {issues.length}
        </span>
      </div>

      <div>
        {issues.length === 0 ? (
          <div className="sr-only">{emptyMessage}</div>
        ) : (
          <div className="flex flex-col">
            {issues.map((issue) => (
              <IssueRow
                issue={issue}
                key={`${issue.provider}-${issue.id}-${issue.url}`}
                onOpenLinkedPullRequest={onOpenLinkedPullRequest}
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
