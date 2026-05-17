import { ChatBubbleLeftIcon } from "@heroicons/react/20/solid";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getGithubUserAvatarUrl } from "@/lib/github-owner";
import { IssueProviderBadge } from "./IssueProviderBadge";
import { IssueTitle } from "./IssueTitle";
import {
  LinkedPullRequestPills,
  MetadataPill,
} from "./IssueMetadataPills";
import type { IssueLinkedPullRequest, IssueSummary } from "@/types/issues";

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

function getRepoPillLabel(repo: string) {
  return repo.split("/").at(-1) ?? repo;
}

function formatIssueDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  if (date.getFullYear() === new Date().getFullYear()) {
    return compactDateFormatter.format(date);
  }

  return compactYearDateFormatter.format(date);
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
      {issue.provider === "github" && issue.repo ? (
        <MetadataPill title={issue.repo}>
          {getRepoPillLabel(issue.repo)}
        </MetadataPill>
      ) : null}
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

export { IssueRow };
