import { useState } from "react";
import type { UseRemoteReviewSessionResult } from "../../hooks/useRemoteReviewSession";

const REMOTE_REVIEW_WORKER_DEPLOY_URL =
  "https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Ftanvesh01%2Frudu%2Ftree%2Fmain%2Fcloudflare%2Fremote-review";

type WorkerSetupCardProps = {
  remoteReview: UseRemoteReviewSessionResult;
};

function WorkerSetupCard({ remoteReview }: WorkerSetupCardProps) {
  const { workerConfig } = remoteReview.data;
  const {
    isClearingWorkerConfig,
    isPairingWorkerConfig,
    workerConfigError,
  } = remoteReview.status;
  const [setupWorkerUrl, setSetupWorkerUrl] = useState("");
  const [setupMessage, setSetupMessage] = useState<string | null>(null);
  const isUsingEnvWorkerConfig = workerConfig?.source === "env";

  async function pairSetupWorkerConfig() {
    setSetupMessage(null);
    await remoteReview.actions.pairWorkerConfig({
      workerUrl: setupWorkerUrl,
    });
    setSetupMessage("Worker paired.");
  }

  async function clearWorkerConfig() {
    setSetupMessage(null);
    await remoteReview.actions.clearWorkerConfig();
    setSetupWorkerUrl("");
  }

  if (workerConfig?.configured) {
    return (
      <div className="rounded-lg border border-ink-100 bg-canvas px-2 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate font-mono text-[11px] text-ink-400">
            Worker: {workerConfig.workerUrl}
          </p>
          {!isUsingEnvWorkerConfig ? (
            <button
              className="shrink-0 rounded-md border border-ink-200 px-2 py-1 text-[11px] font-medium text-ink-600 transition hover:bg-ink-50 hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isClearingWorkerConfig}
              onClick={() => void clearWorkerConfig()}
              type="button"
            >
              {isClearingWorkerConfig ? "Clearing..." : "Change"}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-ink-100 bg-canvas p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-ink-600">
          Finish AI chat setup
        </p>
        <a
          className="shrink-0 rounded-md border border-ink-200 px-2 py-1 text-[11px] font-medium text-ink-600 transition hover:bg-ink-50 hover:text-ink-900"
          href={REMOTE_REVIEW_WORKER_DEPLOY_URL}
          rel="noreferrer"
          target="_blank"
        >
          Deploy Worker
        </a>
      </div>

      <div className="mt-3 rounded-md border border-ink-100 bg-surface px-3 py-2 text-xs leading-5 text-ink-600">
        <p>1. Install Pi locally on this machine, including the `pi-acp` runtime.</p>
        <p className="mt-1">2. Deploy your Cloudflare Worker to your own account.</p>
        <p className="mt-1">3. Paste the deployed Worker URL here and pair it with Rudu.</p>
      </div>

      <label className="mt-3 block text-[11px] font-medium text-ink-500">
        Deployed Worker URL
        <input
          className="mt-1 w-full rounded-md border border-ink-200 bg-surface px-2 py-1 font-mono text-[11px] text-ink-700"
          onChange={(event) => setSetupWorkerUrl(event.target.value)}
          placeholder="https://rudu-remote-review.<account>.workers.dev"
          value={setupWorkerUrl}
        />
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className="inline-flex items-center rounded-md bg-ink-900 px-3 py-1.5 text-xs font-medium text-canvas transition hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!setupWorkerUrl || isPairingWorkerConfig}
          onClick={() => void pairSetupWorkerConfig()}
          type="button"
        >
          {isPairingWorkerConfig ? "Pairing..." : "Pair Worker"}
        </button>
      </div>

      {setupMessage ? (
        <p className="mt-2 text-xs text-ink-600">{setupMessage}</p>
      ) : null}
      {workerConfigError ? (
        <p className="mt-2 text-xs leading-5 text-danger-600">
          {workerConfigError}
        </p>
      ) : null}
    </div>
  );
}

export { WorkerSetupCard };
