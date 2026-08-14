import type { ComponentProps } from "react";
import type { LocalCheckout } from "../../types/local-checkouts";

function FloppyDiskIcon(props: ComponentProps<"svg">) {
  return (
    <svg fill="none" viewBox="0 0 16 16" stroke="currentColor" {...props}>
      <path
        d="M2.5 2.5h8.6l2.4 2.4v8.6h-11v-11Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M5 2.5v4h5v-4M5 13.5V9h6v4.5" strokeLinejoin="round" />
    </svg>
  );
}

const activityDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

type LocalCheckoutRowsProps = {
  checkouts: LocalCheckout[];
  onSelectCheckout: (checkout: LocalCheckout) => void;
};

function LocalCheckoutRows({
  checkouts,
  onSelectCheckout,
}: LocalCheckoutRowsProps) {
  return checkouts.map((checkout) => (
    <div key={checkout.id}>
      <button
        className={[
          "relative flex w-full flex-col gap-1 bg-canvas py-2.5 pr-3 pl-6 text-left transition hover:bg-canvasDark focus-visible:bg-surface",
          checkout.available ? "" : "opacity-60",
        ].join(" ")}
        disabled={!checkout.available}
        onClick={() => onSelectCheckout(checkout)}
        title={checkout.path}
        type="button"
      >
        <p className="flex min-w-0 items-center gap-2 text-xs text-ink-500">
          <span className="min-w-0 flex-1 truncate">{checkout.branch}</span>
          {checkout.latestActivityAt > 0 ? (
            <span className="shrink-0">
              {activityDateFormatter.format(checkout.latestActivityAt * 1000)}
            </span>
          ) : null}
        </p>
        <div className="flex min-w-0 items-center gap-2">
          <FloppyDiskIcon className="size-4 shrink-0 text-ink-500" />
          <p className="min-w-0 flex-1 truncate text-sm text-ink-700">
            {checkout.folderName}
          </p>
          <p className="shrink-0 font-mono text-xs font-semibold">
            <span className="text-green-600 dark:text-green-300">
              +{checkout.additions}
            </span>{" "}
            <span className="text-red-600 dark:text-red-300">
              -{checkout.deletions}
            </span>
          </p>
        </div>
      </button>
    </div>
  ));
}

export { LocalCheckoutRows };
