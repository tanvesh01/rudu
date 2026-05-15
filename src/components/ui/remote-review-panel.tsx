import { getRemoteReviewStatusLabel } from "../../lib/remote-review";
import type { UseRemoteReviewSessionResult } from "../../hooks/useRemoteReviewSession";

type RemoteReviewPanelProps = {
  remoteReview: UseRemoteReviewSessionResult;
};

function RemoteReviewPanel({ remoteReview }: RemoteReviewPanelProps) {
  const { report, session } = remoteReview.data;
  const {
    error,
    isLoadingSession,
    isRefreshingReport,
    isRunning,
  } = remoteReview.status;
  const canRun = Boolean(session) && !isLoadingSession && !isRunning;
  const indexedAt = session?.fileContext?.indexedAt ?? null;
  const expiresAt = session?.fileContext?.expiresAt ?? null;

  return (
    <section className="border-t border-ink-100 px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-ink-600">Remote Pi review</p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-ink-400">
            {session ? session.id : "No selected PR"}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-ink-200 bg-canvas px-2 py-0.5 text-[11px] font-medium text-ink-600">
          {isLoadingSession ? "Loading" : getRemoteReviewStatusLabel(session)}
        </span>
      </div>

      <p className="mt-2 text-xs leading-5 text-ink-500">
        Indexes the selected PR file tree through the remote-review Worker,
        then opens Pi in Terminal with read-only file tools.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className="inline-flex items-center rounded-md bg-ink-900 px-3 py-1.5 text-xs font-medium text-canvas transition hover:bg-ink-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-500 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canRun}
          onClick={() => void remoteReview.actions.runReview()}
          type="button"
        >
          {isRunning ? "Starting..." : "Run remote Pi review"}
        </button>
        <button
          className="inline-flex items-center rounded-md border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-600 transition hover:bg-ink-50 hover:text-ink-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-500 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!session || isRefreshingReport}
          onClick={() => void remoteReview.actions.refreshReport()}
          type="button"
        >
          {isRefreshingReport ? "Refreshing..." : "Refresh report"}
        </button>
      </div>

      {session?.fileContext ? (
        <p className="mt-2 truncate font-mono text-[11px] text-ink-400">
          Indexed {session.fileContext.fileCount} files
          {indexedAt ? ` · ${new Date(indexedAt * 1000).toLocaleString()}` : ""}
          {expiresAt ? ` · expires ${new Date(expiresAt * 1000).toLocaleString()}` : ""}
        </p>
      ) : null}

      {error || session?.lastError ? (
        <p className="mt-2 text-xs leading-5 text-danger-600">
          {error || session?.lastError}
        </p>
      ) : null}

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-xs font-medium text-ink-600">Local report</p>
          {report ? (
            <span className="text-[11px] text-ink-400">
              {new Date(report.updatedAt * 1000).toLocaleString()}
            </span>
          ) : null}
        </div>
        {report ? (
          <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-ink-100 bg-canvas p-2 font-mono text-[11px] leading-5 text-ink-800">
            {report.body}
          </pre>
        ) : (
          <p className="rounded-lg border border-dashed border-ink-200 bg-canvas p-2 text-xs text-ink-500">
            No report saved yet. Pi will save one after it calls
            save_remote_review_report.
          </p>
        )}
      </div>
    </section>
  );
}

export { RemoteReviewPanel };
export type { RemoteReviewPanelProps };
