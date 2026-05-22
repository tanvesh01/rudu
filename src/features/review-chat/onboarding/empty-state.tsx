import { MapIcon } from "@heroicons/react/20/solid";

type EmptyChatStateProps = {
  canGenerateWalkthrough?: boolean;
  isGeneratingWalkthrough?: boolean;
  onGenerateWalkthrough?: () => void;
};

function EmptyChatState({
  canGenerateWalkthrough = false,
  isGeneratingWalkthrough = false,
  onGenerateWalkthrough,
}: EmptyChatStateProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col items-center justify-center text-center">
      <p className="mb-4 text-sm font-medium text-ink-800">Talk to Rudu!</p>
      {canGenerateWalkthrough ? (
        <button
          className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-surface px-3 py-1.5 text-sm font-medium text-ink-800 transition hover:border-ink-300 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-100 dark:hover:bg-ink-800"
          disabled={isGeneratingWalkthrough}
          onClick={onGenerateWalkthrough}
          type="button"
        >
          <MapIcon aria-hidden="true" className="size-4" />
          {isGeneratingWalkthrough ? "Generating" : "Review walkthrough"}
        </button>
      ) : null}
      <p className="mb-1 text-sm text-ink-700">Ask anything.</p>
      <p className="max-w-xs text-sm text-ink-500">
        You can use @ or # to mention files and PRs/Issues
      </p>
    </div>
  );
}

export { EmptyChatState };
export type { EmptyChatStateProps };
