import type { ReviewChatRuntimeKind } from "../../../types/github";

const RUNTIME_OPTIONS: Array<{
  value: ReviewChatRuntimeKind;
  label: string;
}> = [
  { value: "codex", label: "Codex" },
  { value: "open_code", label: "OpenCode" },
];

type ReviewRuntimeSelectorProps = {
  disabled?: boolean;
  value: ReviewChatRuntimeKind;
  onValueChange(value: ReviewChatRuntimeKind): void;
};

function ReviewRuntimeSelector({
  disabled = false,
  value,
  onValueChange,
}: ReviewRuntimeSelectorProps) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink-100 bg-canvas/92 px-4 py-2 text-xs">
      <span className="font-medium text-ink-500">Runtime</span>
      <select
        aria-label="Review Chat runtime"
        className="h-7 rounded-md border border-ink-200 bg-surface px-2 text-xs font-medium text-ink-800 outline-none transition hover:border-ink-300 focus:border-ink-500 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        onChange={(event) =>
          onValueChange(event.target.value as ReviewChatRuntimeKind)
        }
        value={value}
      >
        {RUNTIME_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export { ReviewRuntimeSelector };
