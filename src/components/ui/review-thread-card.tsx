import { useState } from "react";
import type { ReviewComment, ReviewThread } from "../../lib/review-threads";
import { CommentMarkdown } from "./comment-markdown";
import { ReviewCommentEditor } from "./review-comment-editor";

type ReviewThreadCardProps = {
  thread: ReviewThread;
  compact?: boolean;
  slim?: boolean;
  viewerLogin?: string | null;
  onReplyToThread?: (thread: ReviewThread, body: string) => Promise<void>;
  onEditComment?: (comment: ReviewComment, body: string) => Promise<void>;
  onClick?: () => void;
  containerRef?: (node: HTMLDivElement | null) => void;
};

function formatTimestamp(value: string) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
    .format(timestamp)
    .toUpperCase();
}

function formatThreadLineLabel(thread: ReviewThread) {
  if (thread.line === null && thread.startLine === null) {
    return "File comment";
  }

  const startLine = thread.startLine ?? thread.line;
  const endLine = thread.line ?? thread.startLine;

  if (startLine === null || endLine === null) {
    return "File comment";
  }

  if (startLine === endLine) {
    return `Line ${startLine}`;
  }

  const minLine = Math.min(startLine, endLine);
  const maxLine = Math.max(startLine, endLine);
  return `Lines ${minLine}-${maxLine}`;
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

function ReviewThreadCard({
  thread,
  compact = false,
  slim = false,
  viewerLogin = null,
  onReplyToThread,
  onEditComment,
  onClick,
  containerRef,
}: ReviewThreadCardProps) {
  const [activeAction, setActiveAction] = useState<
    | { type: "reply" }
    | { type: "edit"; commentId: string }
    | null
  >(null);
  const [actionError, setActionError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const rootComment =
    thread.comments.find((comment) => comment.replyToId === null) ??
    thread.comments[0] ??
    null;

  if (slim) {
    const threadLine = thread.startLine ?? thread.line;
    const locationLabel =
      threadLine === null
        ? `${thread.path} - File comment`
        : `${thread.path}:${threadLine}`;
    const summaryBody = (rootComment?.body ?? "")
      .replace(/\s+/g, " ")
      .trim();

    const content = (
      <>
        {rootComment ? (
          <CommentAvatar comment={rootComment} />
        ) : (
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink-200 text-[11px] font-semibold text-ink-700">
            ?
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="min-w-0 truncate text-sm text-ink-700">
            {summaryBody || "(no comment body)"}
          </p>
          <p className="mt-1 text-xs text-ink-500">{locationLabel}</p>
        </div>
      </>
    );

    const baseClassName =
      "flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left";

    return onClick ? (
      <button
        className={`${baseClassName} transition hover:bg-canvasDark focus-visible:bg-surface`}
        onClick={onClick}
        type="button"
      >
        {content}
      </button>
    ) : (
      <div className={baseClassName}>{content}</div>
    );
  }

  async function handleReplySubmit(body: string) {
    if (!rootComment || !onReplyToThread) {
      return;
    }

    setIsSubmitting(true);
    setActionError("");

    try {
      await onReplyToThread(thread, body);
      setActiveAction(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleEditSubmit(comment: ReviewComment, body: string) {
    if (!onEditComment) {
      return;
    }

    setIsSubmitting(true);
    setActionError("");

    try {
      await onEditComment(comment, body);
      setActiveAction(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      className="rounded-lg border border-ink-200 bg-canvas p-3 text-sm text-ink-800 shadow-sm"
      ref={containerRef}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-ink-500">
        <span className="font-sans font-medium text-ink-900">
          {formatThreadLineLabel(thread)}
        </span>
        {thread.isResolved ? (
          <span className="rounded-full bg-canvas px-2 py-0.5 font-sans text-ink-700">
            Resolved
          </span>
        ) : null}
        {thread.isOutdated ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-sans text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            Outdated
          </span>
        ) : null}
        <span className="font-sans">{thread.comments.length} comments</span>
      </div>

      <div className="flex flex-col gap-3">
        {thread.comments.map((comment) => {
          const isEditing =
            activeAction?.type === "edit" && activeAction.commentId === comment.id;
          const canEdit =
            viewerLogin != null &&
            viewerLogin === comment.authorLogin &&
            comment.id.length > 0 &&
            onEditComment != null;

          return (
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3" key={comment.id}>
              <CommentAvatar comment={comment} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
                  <span className="font-sans font-medium text-ink-900">
                    {comment.authorLogin}
                  </span>
                  <span>{formatTimestamp(comment.createdAt)}</span>
                  {!compact && comment.url ? (
                    <a
                      className="text-ink-600 underline-offset-2 hover:text-ink-900 hover:underline"
                      href={comment.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Open
                    </a>
                  ) : null}
                  {canEdit ? (
                    <button
                      className="text-ink-600 underline-offset-2 hover:text-ink-900 hover:underline"
                      onClick={() => {
                        setActionError("");
                        setActiveAction({ type: "edit", commentId: comment.id });
                      }}
                      type="button"
                    >
                      Edit
                    </button>
                  ) : null}
                </div>
                <div className="mt-1 min-w-0">
                  {isEditing ? (
                    <ReviewCommentEditor
                      error={actionError}
                      initialValue={comment.body}
                      isPending={isSubmitting}
                      submitLabel="Save"
                      onCancel={() => {
                        setActionError("");
                        setActiveAction(null);
                      }}
                      onSubmit={(body) => handleEditSubmit(comment, body)}
                    />
                  ) : (
                    <CommentMarkdown body={comment.body} />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {rootComment && onReplyToThread ? (
        <div className="mt-3 border-t border-ink-200 pt-3">
          {activeAction?.type === "reply" ? (
            <ReviewCommentEditor
              error={actionError}
              framed={false}
              isPending={isSubmitting}
              submitLabel="Reply"
              onCancel={() => {
                setActionError("");
                setActiveAction(null);
              }}
              onSubmit={handleReplySubmit}
              placeholder="Reply to this thread"
            />
          ) : (
            <button
              className="font-sans text-xs font-medium text-ink-600 underline-offset-2 hover:text-ink-900 hover:underline"
              onClick={() => {
                setActionError("");
                setActiveAction({ type: "reply" });
              }}
              type="button"
            >
              Reply
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

export { ReviewThreadCard };
export type { ReviewThreadCardProps };
