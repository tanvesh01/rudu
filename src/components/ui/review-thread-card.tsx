import { useState } from "react";
import type { ReviewComment, ReviewThread } from "../../lib/review-threads";
import {
  inferCodeLanguageFromPath,
  requiresRawMarkdownEditor,
  ReviewCommentComposer,
} from "./review-comment-composer";
import { ReviewCommentBody } from "./review-comment-body";
import { ReviewCommentMarkdownTextarea } from "./review-comment-markdown-textarea";
import { PencilSquareIcon } from "@heroicons/react/16/solid";

type ReviewThreadCardProps = {
  thread: ReviewThread;
  compact?: boolean;
  slim?: boolean;
  viewerLogin?: string | null;
  activeEditCommentId?: string | null;
  isReplyComposerActive?: boolean;
  suggestionSeed?: string;
  suggestionLanguage?: string;
  onReplyToThread?: (thread: ReviewThread, body: string) => Promise<void>;
  onEditComment?: (comment: ReviewComment, body: string) => Promise<void>;
  onComposerDirtyChange?: (isDirty: boolean) => void;
  onRequestEditComposer?: (comment: ReviewComment) => void;
  onRequestReplyComposer?: (thread: ReviewThread) => void;
  onRequestCloseComposer?: () => void;
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

function threadSupportsSuggestion(thread: ReviewThread) {
  return thread.line !== null || thread.startLine !== null;
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
  activeEditCommentId = null,
  isReplyComposerActive = false,
  suggestionSeed,
  suggestionLanguage = inferCodeLanguageFromPath(thread.path),
  onReplyToThread,
  onEditComment,
  onComposerDirtyChange,
  onRequestEditComposer,
  onRequestReplyComposer,
  onRequestCloseComposer,
  onClick,
  containerRef,
}: ReviewThreadCardProps) {
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
    const summaryBody = (rootComment?.body ?? "").replace(/\s+/g, " ").trim();

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

    setActionError("");
    setIsSubmitting(true);

    try {
      await onReplyToThread(thread, body);
    } catch (error) {
      setActionError(
        error instanceof Error && error.message
          ? error.message
          : "Something went wrong while sending your reply.",
      );
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
          const isEditing = activeEditCommentId === comment.id;
          const canEdit =
            viewerLogin != null &&
            viewerLogin === comment.authorLogin &&
            comment.id.length > 0 &&
            onEditComment != null;

          return (
            <div
              className="group grid grid-cols-[auto_minmax(0,1fr)] gap-3"
              key={comment.id}
            >
              <CommentAvatar comment={comment} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500 w-full">
                  <span className="font-sans text-ink-600 text-sm font-medium">
                    {comment.authorLogin}
                  </span>
                  <div className="flex gap-2 items-center opacity-0 transition-opacity duration-150 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto">
                    <span className="font-sans text-xs">
                      {formatTimestamp(comment.createdAt)}
                    </span>
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
                        className="rounded-md p-1 text-ink-600 hover:bg-canvasDark hover:text-ink-900"
                        onClick={() => {
                          setActionError("");
                          onRequestEditComposer?.(comment);
                        }}
                        type="button"
                      >
                        <PencilSquareIcon className="size-4 text-ink-500" />
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-1 min-w-0">
                  {isEditing ? (
                    requiresRawMarkdownEditor(comment.body) ? (
                      <div className="space-y-2">
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          This comment contains markdown the phase 1 Lexical
                          editor cannot round-trip safely. Editing stays in raw
                          markdown for this comment.
                        </div>
                        <ReviewCommentMarkdownTextarea
                          error={actionError}
                          initialValue={comment.body}
                          isPending={isSubmitting}
                          submitLabel="Save"
                          onCancel={() => {
                            setActionError("");
                            onRequestCloseComposer?.();
                          }}
                          onDirtyChange={onComposerDirtyChange}
                          onSubmit={(body) => handleEditSubmit(comment, body)}
                        />
                      </div>
                    ) : (
                      <ReviewCommentComposer
                        allowSuggestion={
                          threadSupportsSuggestion(thread) &&
                          Boolean(suggestionSeed)
                        }
                        error={actionError}
                        initialValue={comment.body}
                        isPending={isSubmitting}
                        suggestionLanguage={suggestionLanguage}
                        suggestionSeed={suggestionSeed}
                        submitLabel="Save"
                        onCancel={() => {
                          setActionError("");
                          onRequestCloseComposer?.();
                        }}
                        onDirtyChange={onComposerDirtyChange}
                        onSubmit={(body) => handleEditSubmit(comment, body)}
                      />
                    )
                  ) : (
                    <ReviewCommentBody
                      body={comment.body}
                      endLine={thread.line ?? thread.startLine}
                      path={thread.path}
                      startLine={thread.startLine ?? thread.line}
                      suggestionLanguage={suggestionLanguage}
                      suggestionSeed={suggestionSeed}
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {rootComment && onReplyToThread ? (
        <div className="mt-3 border-t border-ink-200 pt-3">
          {isReplyComposerActive ? (
            <ReviewCommentComposer
              allowSuggestion={
                threadSupportsSuggestion(thread) && Boolean(suggestionSeed)
              }
              framed={false}
              isPending={isSubmitting}
              suggestionLanguage={suggestionLanguage}
              suggestionSeed={suggestionSeed}
              submitLabel="Reply"
              onCancel={() => {
                setActionError("");
                onRequestCloseComposer?.();
              }}
              onDirtyChange={onComposerDirtyChange}
              onSubmit={handleReplySubmit}
              placeholder="Reply to this thread"
            />
          ) : (
            <button
              className="font-sans flex items-center gap-1 rounded-md bg-canvas px-2 py-1 text-sm font-medium text-ink-500 transition hover:bg-canvasDark disabled:cursor-default disabled:opacity-60 dark:bg-ink-200 dark:text-ink-900 dark:hover:bg-ink-300"
              disabled={isSubmitting}
              onClick={() => {
                setActionError("");
                onRequestReplyComposer?.(thread);
              }}
              type="button"
            >
              Reply
            </button>
          )}
          {actionError && !isEditingThreadComment(activeEditCommentId, thread) ? (
            <div className="mt-2 text-sm text-danger-600">
              Something went wrong while sending your reply.
              {/* TODO: Replace this inline error with a toast-based error flow. */}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function isEditingThreadComment(
  activeEditCommentId: string | null,
  thread: ReviewThread,
) {
  if (!activeEditCommentId) {
    return false;
  }

  return thread.comments.some((comment) => comment.id === activeEditCommentId);
}

export { ReviewThreadCard };
export type { ReviewThreadCardProps };
