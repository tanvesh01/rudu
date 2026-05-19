import { InboxStackIcon } from "@heroicons/react/20/solid";

type IssuesNavButtonProps = {
  isActive: boolean;
  count: number | null;
  onSelect: () => void;
};

function IssuesNavButton({ isActive, count, onSelect }: IssuesNavButtonProps) {
  return (
    <div className="px-2 py-2">
      <button
        className={[
          "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition hover:bg-canvasDark focus-visible:bg-canvasDark focus-visible:outline-none",
          isActive ? "bg-canvasDark text-ink-800" : "text-ink-700",
        ].join(" ")}
        onClick={onSelect}
        type="button"
      >
        <InboxStackIcon className="size-5 shrink-0 text-ink-500" />
        <span className="min-w-0 flex-1 truncate">Issues</span>
        {count !== null && count > 0 ? (
          <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-ink-600">
            {count}
          </span>
        ) : null}
      </button>
    </div>
  );
}

export { IssuesNavButton };
export type { IssuesNavButtonProps };
