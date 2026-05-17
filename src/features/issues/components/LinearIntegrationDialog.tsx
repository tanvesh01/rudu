import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircleIcon } from "@heroicons/react/20/solid";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { FormEvent } from "react";
import { useLinearIntegrationDialogStore } from "./LinearIntegrationDialog-store";
import { getErrorMessage } from "@/lib/get-error-message";
import {
  deleteLinearApiKey,
  githubKeys,
  issueBucketCountsQueryOptions,
  saveLinearApiKey,
} from "@/queries/github";
import type { LinearIntegrationStatus } from "@/types/issues";

const LINEAR_API_KEY_GUIDE_URL = "https://linear.app/docs/api-and-webhooks";
const LINEAR_AUTH_DETAILS_URL =
  "https://linear.app/developers/graphql#personal-api-keys";

type LinearIntegrationDialogProps = {
  status: LinearIntegrationStatus;
};

function LinearIntegrationDialog({ status }: LinearIntegrationDialogProps) {
  const queryClient = useQueryClient();
  const apiKey = useLinearIntegrationDialogStore((state) => state.apiKey);
  const isOpen = useLinearIntegrationDialogStore((state) => state.isOpen);
  const isReplacing = useLinearIntegrationDialogStore(
    (state) => state.isReplacing,
  );
  const store = useLinearIntegrationDialogStore;

  async function refreshIssueQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: githubKeys.issueDashboard() }),
      queryClient.invalidateQueries({
        queryKey: issueBucketCountsQueryOptions().queryKey,
      }),
    ]);
  }

  const saveLinearApiKeyMutation = useMutation({
    mutationFn: saveLinearApiKey,
    onSuccess: async () => {
      await refreshIssueQueries();
      store.getState().closeAndReset();
    },
  });
  const deleteLinearApiKeyMutation = useMutation({
    mutationFn: deleteLinearApiKey,
    onSuccess: async () => {
      await refreshIssueQueries();
      store.getState().resetCredentialForm();
    },
  });

  const showInput = !status.connected || isReplacing;
  const isSaving = saveLinearApiKeyMutation.isPending;
  const isRemoving = deleteLinearApiKeyMutation.isPending;
  const isBusy = isSaving || isRemoving;
  const displayedError =
    getErrorMessage(saveLinearApiKeyMutation.error) ||
    getErrorMessage(deleteLinearApiKeyMutation.error) ||
    status.error;

  function resetDialogState(open: boolean) {
    store.getState().openChange(open);
    saveLinearApiKeyMutation.reset();
    deleteLinearApiKeyMutation.reset();
  }

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveLinearApiKeyMutation.mutate(apiKey);
  }

  function handleRemove() {
    deleteLinearApiKeyMutation.mutate();
  }

  function handleApiKeyChange(apiKey: string) {
    saveLinearApiKeyMutation.reset();
    deleteLinearApiKeyMutation.reset();
    store.getState().setApiKey(apiKey);
  }

  return (
    <DialogPrimitive.Root onOpenChange={resetDialogState} open={isOpen}>
      <DialogPrimitive.Trigger
        className="group flex flex-col items-start gap-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
        type="button"
      >
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-700">
          <CheckCircleIcon
            aria-hidden="true"
            className="h-4 w-4 text-emerald-600"
          />
          {status.connected
            ? "GitHub and Linear connected"
            : "GitHub connected"}
        </span>
        {!status.connected ? (
          <span className="text-sm font-medium text-ink-800 transition group-hover:text-ink-600">
            Connect Linear now
          </span>
        ) : null}
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-slate-950/50" />
        <DialogPrimitive.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <DialogPrimitive.Popup className="flex max-h-[82vh] w-full max-w-[520px] flex-col rounded-xl bg-surface shadow-dialog outline-none">
            <div className="border-b border-ink-200 px-5 py-4">
              <DialogPrimitive.Title className="m-0 text-base font-semibold text-ink-900">
                Integrate Linear into Rudu
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-sm text-ink-600">
                Use a Linear personal API key so Rudu can show Linear issues in
                the issue dashboard.
              </DialogPrimitive.Description>
            </div>

            <form className="flex min-h-0 flex-col" onSubmit={handleSave}>
              <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-4">
                <div className="flex flex-wrap gap-3 text-sm">
                  <a
                    className="font-medium text-ink-800 transition hover:text-ink-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                    href={LINEAR_API_KEY_GUIDE_URL}
                    onClick={(event) => {
                      event.preventDefault();
                      void openUrl(LINEAR_API_KEY_GUIDE_URL);
                    }}
                  >
                    Open Linear API key guide
                  </a>
                  <a
                    className="font-medium text-ink-600 transition hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                    href={LINEAR_AUTH_DETAILS_URL}
                    onClick={(event) => {
                      event.preventDefault();
                      void openUrl(LINEAR_AUTH_DETAILS_URL);
                    }}
                  >
                    Authentication details
                  </a>
                </div>

                {status.connected && !isReplacing ? (
                  <div className="rounded-md border border-ink-200 bg-canvas px-3 py-2 text-sm text-ink-700">
                    Connected
                    {status.displayName ? ` as ${status.displayName}` : null}.
                  </div>
                ) : null}

                {displayedError ? (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger-600">
                    {displayedError}
                  </div>
                ) : null}

                {showInput ? (
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium text-ink-700">
                      Linear API key
                    </span>
                    <input
                      autoComplete="off"
                      className="w-full rounded-md border border-ink-300 bg-canvas px-3 py-2 text-sm text-ink-900 outline-none transition placeholder:text-ink-400 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20 disabled:cursor-default disabled:opacity-60"
                      disabled={isBusy}
                      onChange={(event) => handleApiKeyChange(event.target.value)}
                      placeholder="lin_api_..."
                      type="password"
                      value={apiKey}
                    />
                  </label>
                ) : null}
              </div>

              <div className="flex justify-end gap-2 border-t border-ink-200 px-5 py-4">
                <DialogPrimitive.Close
                  className="rounded-md px-3 py-1.5 text-sm text-ink-700 transition hover:bg-canvasDark disabled:cursor-default disabled:opacity-60"
                  disabled={isBusy}
                  type="button"
                >
                  Cancel
                </DialogPrimitive.Close>

                {status.connected && !isReplacing ? (
                  <>
                    <button
                      className="rounded-md px-3 py-1.5 text-sm text-ink-700 transition hover:bg-canvasDark disabled:cursor-default disabled:opacity-60"
                      disabled={isBusy}
                      onClick={() => {
                        saveLinearApiKeyMutation.reset();
                        deleteLinearApiKeyMutation.reset();
                        store.getState().startReplacing();
                      }}
                      type="button"
                    >
                      Replace API key
                    </button>
                    <button
                      className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-danger-600 transition hover:bg-red-50 disabled:cursor-default disabled:opacity-60"
                      disabled={isBusy}
                      onClick={handleRemove}
                      type="button"
                    >
                      {isRemoving ? "Removing..." : "Remove integration"}
                    </button>
                  </>
                ) : (
                  <>
                    {status.configured ? (
                      <button
                        className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-danger-600 transition hover:bg-red-50 disabled:cursor-default disabled:opacity-60"
                        disabled={isBusy}
                        onClick={handleRemove}
                        type="button"
                      >
                        {isRemoving ? "Removing..." : "Remove integration"}
                      </button>
                    ) : null}
                    <button
                      className="rounded-md border border-brand-600 bg-brand-600 px-3 py-1.5 text-sm text-white transition hover:bg-brand-500 disabled:cursor-default disabled:opacity-60"
                      disabled={isBusy || apiKey.trim().length === 0}
                      type="submit"
                    >
                      {isSaving ? "Saving..." : "Save integration"}
                    </button>
                  </>
                )}
              </div>
            </form>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export { LinearIntegrationDialog };
