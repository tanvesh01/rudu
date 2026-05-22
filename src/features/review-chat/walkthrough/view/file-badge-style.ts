const fileBadgeBaseClassName =
  "inline-flex min-w-0 shrink-0 items-center gap-1.5 rounded-md border border-ink-200 bg-surface px-2 py-1 text-xs text-ink-900 shadow-sm shadow-black/10 dark:border-ink-300 dark:bg-ink-200";

function getFileBadgeClassName({
  canSelect,
  widthClassName,
}: {
  canSelect: boolean;
  widthClassName: string;
}) {
  return [
    fileBadgeBaseClassName,
    widthClassName,
    canSelect
      ? "transition hover:border-ink-300 hover:bg-white dark:hover:border-ink-400 dark:hover:bg-ink-300"
      : "",
  ].join(" ");
}

export { getFileBadgeClassName };
