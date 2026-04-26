import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  deleteLlmApiKey,
  llmKeys,
  llmProvidersQueryOptions,
  llmSettingsQueryOptions,
  saveLlmSettings,
  setLlmApiKey,
  testLlmProvider,
} from "../../queries/llm";

type LlmSettingsModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : null;
}

function formatDuration(ms: number) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function LlmSettingsModal({ open, onOpenChange }: LlmSettingsModalProps) {
  const queryClient = useQueryClient();
  const providersQuery = useQuery(llmProvidersQueryOptions());
  const settingsQuery = useQuery(llmSettingsQueryOptions());
  const providers = providersQuery.data ?? [];
  const settings = settingsQuery.data ?? null;
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  const selectedProvider = useMemo(
    () => providers.find((item) => item.id === provider) ?? providers[0],
    [provider, providers],
  );

  useEffect(() => {
    if (!open || !settings) return;

    setProvider(settings.provider);
    setModel(settings.model);
    setBaseUrl(settings.baseUrl ?? "");
    setApiKey("");
    setFeedback("");
    setError("");
  }, [open, settings]);

  const saveMutation = useMutation({
    mutationFn: () =>
      saveLlmSettings({
        provider,
        model,
        baseUrl: normalizeBaseUrl(baseUrl),
      }),
    onSuccess: (nextSettings) => {
      queryClient.setQueryData(llmKeys.settings(), nextSettings);
    },
  });

  const keyMutation = useMutation({
    mutationFn: (key: string) => setLlmApiKey(provider, key),
    onSuccess: (nextSettings) => {
      queryClient.setQueryData(llmKeys.settings(), nextSettings);
    },
  });

  const deleteKeyMutation = useMutation({
    mutationFn: () => deleteLlmApiKey(provider),
    onSuccess: (nextSettings) => {
      queryClient.setQueryData(llmKeys.settings(), nextSettings);
      setApiKey("");
      setFeedback("API key removed.");
    },
  });

  const testMutation = useMutation({
    mutationFn: testLlmProvider,
  });

  const isPending =
    saveMutation.isPending ||
    keyMutation.isPending ||
    deleteKeyMutation.isPending ||
    testMutation.isPending;

  function applyProviderDefaults(nextProviderId: string) {
    const nextProvider = providers.find((item) => item.id === nextProviderId);
    setProvider(nextProviderId);
    setModel(nextProvider?.defaultModel ?? "");
    setBaseUrl(nextProvider?.defaultBaseUrl ?? "");
    setFeedback("");
    setError("");
  }

  async function saveCurrentSettings() {
    setError("");
    setFeedback("");
    const nextSettings = await saveMutation.mutateAsync();

    if (apiKey.trim()) {
      const settingsWithKey = await keyMutation.mutateAsync(apiKey);
      setApiKey("");
      return settingsWithKey;
    }

    return nextSettings;
  }

  async function handleSave() {
    try {
      await saveCurrentSettings();
      setFeedback("Provider saved.");
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function handleTest() {
    try {
      setError("");
      setFeedback("");
      await saveCurrentSettings();
      const startedAt = performance.now();
      await testMutation.mutateAsync();
      setFeedback(
        `Connection successful. Model responded in ${formatDuration(
          performance.now() - startedAt,
        )}.`,
      );
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : String(caught);
      setError(
        `Connection failed. Check the base URL, model name, or API key. ${detail}`,
      );
    }
  }

  async function handleDeleteKey() {
    try {
      setError("");
      await deleteKeyMutation.mutateAsync();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  const hasSavedKey =
    settings?.provider === provider ? settings.hasApiKey : false;
  const canSave =
    !isPending &&
    provider.trim().length > 0 &&
    model.trim().length > 0 &&
    (!selectedProvider?.baseUrlRequired || normalizeBaseUrl(baseUrl) !== null);

  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent className="max-w-[620px] overflow-hidden border border-ink-200">
        <div className="border-b border-ink-200 px-5 py-4">
          <AlertDialogHeader>
            <AlertDialogTitle>AI Provider</AlertDialogTitle>
            <AlertDialogDescription>
              Bring your own model key for PR summaries, review chapters, and AI
              diff guidance.
            </AlertDialogDescription>
          </AlertDialogHeader>
        </div>

        <div className="min-h-0 overflow-y-auto px-5 py-4">
          <div className="grid gap-4">
            <label className="grid gap-1.5 text-sm">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-500">
                Provider
              </span>
              <select
                className="h-10 rounded-lg border border-ink-200 bg-canvas px-3 text-sm text-ink-900 outline-none transition focus:border-ink-400"
                disabled={isPending || providersQuery.isLoading}
                onChange={(event) => applyProviderDefaults(event.currentTarget.value)}
                value={provider}
              >
                {providers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="grid gap-1.5 text-sm">
                <span className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Model
                </span>
                <input
                  className="h-10 rounded-lg border border-ink-200 bg-canvas px-3 text-sm text-ink-900 outline-none transition placeholder:text-ink-500 focus:border-ink-400"
                  disabled={isPending}
                  onChange={(event) => setModel(event.currentTarget.value)}
                  placeholder={selectedProvider?.defaultModel || "model"}
                  value={model}
                />
              </label>

              <label className="grid gap-1.5 text-sm">
                <span className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Base URL
                </span>
                <input
                  className="h-10 rounded-lg border border-ink-200 bg-canvas px-3 text-sm text-ink-900 outline-none transition placeholder:text-ink-500 focus:border-ink-400"
                  disabled={isPending}
                  onChange={(event) => setBaseUrl(event.currentTarget.value)}
                  placeholder={
                    selectedProvider?.defaultBaseUrl ??
                    "https://provider.example/v1"
                  }
                  value={baseUrl}
                />
              </label>
            </div>

            <label className="grid gap-1.5 text-sm">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-500">
                API key
              </span>
              <input
                className="h-10 rounded-lg border border-ink-200 bg-canvas px-3 text-sm text-ink-900 outline-none transition placeholder:text-ink-500 focus:border-ink-400"
                disabled={isPending}
                onChange={(event) => setApiKey(event.currentTarget.value)}
                placeholder={hasSavedKey ? "Saved in system keychain" : "Paste key"}
                type="password"
                value={apiKey}
              />
            </label>

            {hasSavedKey ? (
              <div className="flex items-center justify-between rounded-lg border border-ink-200 bg-canvas px-3 py-2 text-sm">
                <span className="text-ink-600">
                  API key saved in your system keychain. It will not be shown
                  again.
                </span>
                <button
                  className="rounded-md px-2 py-1 text-xs font-medium text-danger-600 transition hover:bg-surface"
                  disabled={isPending}
                  onClick={() => void handleDeleteKey()}
                  type="button"
                >
                  Remove
                </button>
              </div>
            ) : null}

            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger-600 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
                {error}
              </div>
            ) : null}

            {feedback ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
                {feedback}
              </div>
            ) : null}

            <p className="text-xs leading-5 text-ink-500">
              This provider will be used to generate PR summaries, review
              chapters, and AI diff guidance.
            </p>
          </div>
        </div>

        <AlertDialogFooter className="border-t border-ink-200 px-5 py-4">
          <button
            className={cx(
              "rounded-lg px-3.5 py-2.5 text-sm font-medium text-ink-700 transition hover:bg-canvasDark hover:text-ink-900",
              isPending && "cursor-default opacity-60",
            )}
            disabled={!canSave}
            onClick={() => void handleTest()}
            type="button"
          >
            {testMutation.isPending ? "Testing..." : "Test connection"}
          </button>
          <AlertDialogCancel disabled={isPending} type="button">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={!canSave}
            onClick={() => void handleSave()}
            type="button"
          >
            {saveMutation.isPending || keyMutation.isPending ? "Saving..." : "Save"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export { LlmSettingsModal };
export type { LlmSettingsModalProps };
