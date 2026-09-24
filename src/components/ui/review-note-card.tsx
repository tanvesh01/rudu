import { useState } from "react";
import { DocumentTextIcon } from "@heroicons/react/16/solid";
import { getErrorMessage } from "../../lib/get-error-message";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./alert-dialog";
import type { ReviewThread } from "../../lib/review-threads";
import { ReviewCommentBody } from "./review-comment-body";

type ReviewNoteCardProps = {
  thread: ReviewThread;
  compact?: boolean;
  containerRef?: (node: HTMLDivElement | null) => void;
  onClick?: () => void;
  onPost?: (noteId: string) => Promise<void>;
  githubTarget?: string;
};

function ReviewNoteCard({
  thread,
  compact = false,
  containerRef,
  onClick,
  onPost,
  githubTarget,
}: ReviewNoteCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [postError, setPostError] = useState("");
  const root =
    thread.comments.find((comment) => comment.replyToId === null) ??
    thread.comments[0];
  if (!root) return null;

  async function post() {
    if (!onPost) return;
    setIsPosting(true);
    setPostError("");
    try {
      await onPost(root.id);
      setConfirmOpen(false);
    } catch (error) {
      setPostError(getErrorMessage(error));
    } finally {
      setIsPosting(false);
    }
  }

  return (
    <div
      className={`rounded-lg border border-dashed border-amber-300 bg-amber-50/80 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/25 dark:text-amber-100 ${onClick ? "cursor-pointer transition hover:bg-amber-100/80 dark:hover:bg-amber-950/40" : ""}`}
      onClick={
        onClick
          ? (event) => {
              if ((event.target as HTMLElement).closest("a, button")) return;
              onClick();
            }
          : undefined
      }
      onKeyDown={
        onClick
          ? (event) => {
              if (
                event.target !== event.currentTarget ||
                (event.key !== "Enter" && event.key !== " ")
              )
                return;
              event.preventDefault();
              onClick();
            }
          : undefined
      }
      ref={containerRef}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="mb-2 flex items-center gap-2 text-xs">
        <DocumentTextIcon className="size-4 text-amber-600" />
        <span className="rounded-full border border-amber-300 px-1.5 py-0.5 dark:border-amber-800">
          Local
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {thread.comments.map((note) => (
          <div
            className="grid grid-cols-[auto_minmax(0,1fr)] gap-2"
            key={note.id}
          >
            <span className="flex size-7 items-center justify-center rounded-full bg-amber-200 text-xs font-semibold text-amber-800 dark:bg-amber-900 dark:text-amber-100">
              {note.authorLogin.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-1.5 text-xs">
                <span className="font-medium">{note.authorLogin}</span>
                {note.authorAssociation === "AGENT" ? (
                  <span className="rounded-full bg-amber-200 px-1.5 py-0.5 text-amber-800 dark:bg-amber-900 dark:text-amber-100">
                    Agent
                  </span>
                ) : null}
              </div>
              <div className={compact ? "line-clamp-3" : ""}>
                <ReviewCommentBody
                  body={note.body}
                  endLine={thread.line}
                  path={thread.path}
                  startLine={thread.startLine}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      {onPost ? (
        <>
          <button
            className="mt-3 text-xs font-medium text-amber-800 underline-offset-2 hover:underline dark:text-amber-200"
            onClick={() => setConfirmOpen(true)}
            type="button"
          >
            Comment on GitHub
          </button>
          <AlertDialog
            onOpenChange={(open) => {
              if (!isPosting) setConfirmOpen(open);
            }}
            open={confirmOpen}
          >
            <AlertDialogContent className="p-4">
              <AlertDialogHeader>
                <AlertDialogTitle>Comment on GitHub?</AlertDialogTitle>
                <AlertDialogDescription>
                  Post this note to {githubTarget ?? "GitHub"} as your GitHub
                  account? Its private thread (including replies) will be
                  removed from Rudu. This cannot be undone in Rudu.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <blockquote className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-canvas p-3 text-sm text-ink-700">
                {root.body}
              </blockquote>
              {postError ? (
                <p className="text-sm text-danger-600">
                  {postError} Check GitHub before retrying.
                </p>
              ) : null}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isPosting} type="button">
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={isPosting}
                  onClick={() => void post()}
                  type="button"
                >
                  {isPosting ? "Posting…" : "Post to GitHub"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}
    </div>
  );
}

export { ReviewNoteCard };
