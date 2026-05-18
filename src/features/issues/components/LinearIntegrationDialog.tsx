import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  TrashIcon,
} from "@heroicons/react/20/solid";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { FormEvent } from "react";
import { LinearBadge } from "./IssueProviderBadge";
import { useLinearIntegrationDialogStore } from "../stores/linear-integration-dialog-store";
import { getErrorMessage } from "@/lib/get-error-message";
import {
  deleteLinearApiKey,
  githubKeys,
  issueBucketCountsQueryOptions,
  saveLinearApiKey,
} from "@/queries/github";
import type { LinearIntegrationStatus } from "@/types/issues";

const LINEAR_API_KEY_GUIDE_URL = "https://linear.app/docs/api-and-webhooks";

type LinearIntegrationDialogProps = {
  status: LinearIntegrationStatus;
  isLoading?: boolean;
};

function LinearIntegrationDialog({ status, isLoading = false }: LinearIntegrationDialogProps) {
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
    onSuccess: () => {
      store.getState().closeAndReset();
      void refreshIssueQueries();
    },
  });
  const deleteLinearApiKeyMutation = useMutation({
    mutationFn: deleteLinearApiKey,
    onSuccess: () => {
      store.getState().resetCredentialForm();
      void refreshIssueQueries();
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

  function handleCancel() {
    store.getState().closeAndReset();
  }

  function handleApiKeyChange(apiKey: string) {
    saveLinearApiKeyMutation.reset();
    deleteLinearApiKeyMutation.reset();
    store.getState().setApiKey(apiKey);
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 text-xs font-medium text-ink-700">
        <span className="size-4 animate-spin rounded-full border-2 border-ink-300 border-t-ink-700" />
        Checking integrations...
      </div>
    );
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
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <DialogPrimitive.Popup className="flex max-h-[82vh] w-full max-w-[520px] flex-col rounded-xl bg-surface shadow-dialog outline-none">
            <div className="px-5 py-4">
              <DialogPrimitive.Title className="mb-2 flex items-center gap-2 text-base font-semibold text-ink-900">
                <span>Integrate</span>
                <LinearBadge />
                <span>into Rudu</span>
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-sm text-ink-600">
                <a
                  className="inline-flex items-center gap-1 text-xs font-medium text-ink-700 underline underline-offset-2 transition hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                  href={LINEAR_API_KEY_GUIDE_URL}
                  onClick={(event) => {
                    event.preventDefault();
                    void openUrl(LINEAR_API_KEY_GUIDE_URL);
                  }}
                >
                  Get your personal API key from Linear
                  <ArrowTopRightOnSquareIcon
                    aria-hidden="true"
                    className="size-3.5 shrink-0"
                  />
                </a>
              </DialogPrimitive.Description>
            </div>

            <form className="flex min-h-0 flex-col" onSubmit={handleSave}>
              <div className="min-h-0 space-y-4 overflow-y-auto px-5">
                {status.connected && !isReplacing ? (
                  <div className="space-y-1 py-2">
                    <div className="inline-flex items-center gap-2 text-sm text-ink-700">
                      <CheckCircleIcon
                        aria-hidden="true"
                        className="size-4 shrink-0 text-emerald-600"
                      />
                      <span>Connected</span>
                      {status.displayName ? ` as ${status.displayName}` : null}.
                    </div>
                    <button
                      className="block text-left text-xs font-medium text-ink-600 underline underline-offset-2 transition hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:cursor-default disabled:opacity-60"
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
                  </div>
                ) : null}

                {displayedError ? (
                  <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger-600">
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
                      className="w-full rounded-md bg-canvas px-3 py-2 text-sm text-ink-900 outline-none transition placeholder:text-ink-400 focus:ring-2 focus:ring-brand-600/20 disabled:cursor-default disabled:opacity-60"
                      disabled={isBusy}
                      onChange={(event) =>
                        handleApiKeyChange(event.target.value)
                      }
                      placeholder="lin_api_..."
                      type="password"
                      value={apiKey}
                    />
                  </label>
                ) : null}
              </div>

              <div className="flex justify-end gap-2 px-5 py-4">
                <button
                  className="rounded-md px-3 py-1.5 text-sm text-ink-700 transition hover:bg-canvasDark disabled:cursor-default disabled:opacity-60"
                  disabled={isBusy}
                  onClick={handleCancel}
                  type="button"
                >
                  Cancel
                </button>

                {status.connected && !isReplacing ? (
                  <>
                    <button
                      className="inline-flex items-center gap-1.5 rounded-md bg-danger-600 px-3 py-1.5 text-sm text-white transition hover:bg-red-700 disabled:cursor-default disabled:opacity-60"
                      disabled={isBusy}
                      onClick={handleRemove}
                      type="button"
                    >
                      <TrashIcon aria-hidden="true" className="size-4 shrink-0" />
                      {isRemoving ? "Removing..." : "Remove integration"}
                    </button>
                  </>
                ) : (
                  <>
                    {status.configured ? (
                      <button
                        className="inline-flex items-center gap-1.5 rounded-md bg-danger-600 px-3 py-1.5 text-sm text-white transition hover:bg-red-700 disabled:cursor-default disabled:opacity-60"
                        disabled={isBusy}
                        onClick={handleRemove}
                        type="button"
                      >
                        <TrashIcon
                          aria-hidden="true"
                          className="size-4 shrink-0"
                        />
                        {isRemoving ? "Removing..." : "Remove integration"}
                      </button>
                    ) : null}
                    <button
                      className="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white transition hover:bg-brand-500 disabled:cursor-default disabled:opacity-60"
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
