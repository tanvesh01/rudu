import type { ReviewComment, ReviewThread } from "../../lib/review-threads";
import { CommentMarkdown } from "./comment-markdown";

type ReviewThreadCardProps = {
  thread: ReviewThread;
  compact?: boolean;
};

function formatTimestamp(value: string) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function formatAssociation(value: string | null) {
  switch (value) {
    case "OWNER":
      return "Owner";
    case "MEMBER":
      return "Member";
    case "COLLABORATOR":
      return "Collaborator";
    case "CONTRIBUTOR":
      return "Contributor";
    default:
      return null;
  }
}

function CommentAvatar({ comment }: { comment: ReviewComment }) {
  const initials = comment.authorLogin.slice(0, 1).toUpperCase();

  if (!comment.authorAvatarUrl) {
    return (
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink-200 text-[11px] font-semibold text-ink-700">
        {initials}
      </div>
    );
  }

  return (
    <img
      alt={comment.authorLogin}
      className="size-8 shrink-0 rounded-full border border-ink-200 object-cover"
      src={comment.authorAvatarUrl}
    />
  );
}

function ReviewThreadCard({ thread, compact = false }: ReviewThreadCardProps) {
  return (
    <div className="rounded-lg border border-ink-200 bg-canvas/90 p-3 text-sm text-ink-800 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-ink-500">
        <span className="font-medium text-ink-900">
          {thread.isResolved ? "Resolved" : "Open thread"}
        </span>
        {thread.isOutdated ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">
            Outdated
          </span>
        ) : null}
        <span>{thread.comments.length} comments</span>
      </div>

      <div className="flex flex-col gap-3">
        {thread.comments.map((comment) => {
          const associationLabel = formatAssociation(comment.authorAssociation);

          return (
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3" key={comment.id}>
            <CommentAvatar comment={comment} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
                <span className="font-medium text-ink-900">{comment.authorLogin}</span>
                {associationLabel ? (
                  <span className="rounded-full bg-canvas px-2 py-0.5 text-ink-600">
                    {associationLabel}
                  </span>
                ) : null}
                <span>{formatTimestamp(comment.createdAt)}</span>
                {!compact ? (
                  <a
                    className="text-ink-600 underline-offset-2 hover:text-ink-900 hover:underline"
                    href={comment.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open
                  </a>
                ) : null}
              </div>
              <div className="mt-1 min-w-0">
                <CommentMarkdown body={comment.body} />
              </div>
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}

export { ReviewThreadCard };
export type { ReviewThreadCardProps };
