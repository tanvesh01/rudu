import { DocumentTextIcon } from "@heroicons/react/16/solid";
import type { ReviewThread } from "../../lib/review-threads";
import { ReviewCommentBody } from "./review-comment-body";

type ReviewNoteCardProps = {
  thread: ReviewThread;
  compact?: boolean;
  containerRef?: (node: HTMLDivElement | null) => void;
  onClick?: () => void;
  onPromote?: (noteId: string) => void;
};

function ReviewNoteCard({
  thread,
  compact = false,
  containerRef,
  onClick,
  onPromote,
}: ReviewNoteCardProps) {
  const root =
    thread.comments.find((comment) => comment.replyToId === null) ??
    thread.comments[0];
  if (!root) return null;

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
      {onPromote ? (
        <button
          className="mt-3 text-xs font-medium text-amber-800 underline-offset-2 hover:underline dark:text-amber-200"
          onClick={() => onPromote(root.id)}
          type="button"
        >
          Turn into GitHub comment
        </button>
      ) : null}
    </div>
  );
}

export { ReviewNoteCard };
