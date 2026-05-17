import { useEffect, useRef } from "react";

import type {
  ReviewWorkspaceActivityStatus,
  ReviewWorkspaceEvent,
} from "../../types/github";

type ReviewWorkspaceActivityEntry = ReviewWorkspaceEvent & {
  id: string;
  createdAt: number;
};

type WorkspaceActivityLogProps = {
  entries: ReviewWorkspaceActivityEntry[];
  error: string | null;
  isLoading: boolean;
  showWhenIdle?: boolean;
};

function statusLabel(status: ReviewWorkspaceActivityStatus) {
  if (status === "running") return "running";
  if (status === "success") return "done";
  return "failed";
}

function statusClassName(status: ReviewWorkspaceActivityStatus) {
  if (status === "running") return "text-amber-500";
  if (status === "success") return "text-emerald-300";
  return "text-danger-600";
}

function WorkspaceActivityLog({
  entries,
  error,
  isLoading,
  showWhenIdle = false,
}: WorkspaceActivityLogProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;

    const frame = requestAnimationFrame(() => {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    });

    return () => cancelAnimationFrame(frame);
  }, [entries, error, isLoading]);

  if (!showWhenIdle && !isLoading && entries.length === 0 && !error) {
    return null;
  }

  return (
    <div className="relative rounded-lg bg-canvas max-w-72 mx-auto">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 rounded-t-lg bg-gradient-to-b from-canvas to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 rounded-b-lg bg-gradient-to-t from-canvas to-transparent" />

      <div
        className="max-h-14  overflow-y-auto px-2.5 py-4 scrollbar-hidden"
        ref={scrollRef}
      >
        <div className="mb-1 flex items-center justify-between gap-3">
          {isLoading ? (
            <p className="text-[11px] text-ink-500">Preparing</p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          {entries.length === 0 && isLoading ? (
            <p className="font-mono text-[11px] leading-4 text-ink-500">
              Waiting for workspace logs...
            </p>
          ) : null}

          {entries.length === 0 && !isLoading && !error ? (
            <p className="font-mono text-[11px] leading-4 text-ink-500">
              No workspace activity yet.
            </p>
          ) : null}

          {entries.map((entry) => (
            <div className="min-w-0" key={entry.id}>
              <div className="flex min-w-0 items-baseline gap-2">
                <span
                  className={`shrink-0 font-mono text-[10px] uppercase ${statusClassName(entry.status)}`}
                >
                  {statusLabel(entry.status)}
                </span>
                <p className="min-w-0 truncate text-[11px] text-ink-700 font-mono">
                  {entry.message}
                </p>
              </div>
              {entry.command ? (
                <p className="mt-0.5 truncate font-mono text-[11px] leading-4 text-ink-500">
                  $ {entry.command}
                </p>
              ) : null}
            </div>
          ))}

          {error ? (
            <p className="text-[11px] leading-4 text-danger-600">{error}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export { WorkspaceActivityLog };
export type { ReviewWorkspaceActivityEntry, WorkspaceActivityLogProps };
