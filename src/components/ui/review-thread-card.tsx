import type { ReviewThread } from "../../lib/review-threads";

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
        {thread.comments.map((comment) => (
          <div
            className="border-l border-ink-200 pl-3 first:border-l-0 first:pl-0"
            key={comment.id}
          >
            <div className="mb-1 flex items-center gap-2 text-xs text-ink-500">
              <span className="font-medium text-ink-900">{comment.authorLogin}</span>
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
            <p className="m-0 whitespace-pre-wrap break-words text-sm leading-6 text-ink-800">
              {comment.body}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export { ReviewThreadCard };
export type { ReviewThreadCardProps };
