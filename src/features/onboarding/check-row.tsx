import type { ReactNode } from "react";
import { CheckBadgeIcon } from "@heroicons/react/24/solid";

type CheckStatus = "checking" | "ready" | "missing";

type CheckRowProps = {
  className?: string;
  detail?: string | null;
  icon?: ReactNode;
  label: string;
  status: CheckStatus;
};

function CheckRow({ className, detail, icon, label, status }: CheckRowProps) {
  const statusLabel =
    status === "checking"
      ? "Checking"
      : status === "ready"
        ? "Connected"
        : "Missing";

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-4">
        <span className="flex min-w-0 items-center gap-3">
          {icon}
          <span className="truncate text-sm">{label}</span>
        </span>
        <span
          className={
            status === "ready"
              ? "inline-flex items-center gap-1.5 text-sm font-medium text-green-500"
              : status === "checking"
                ? "text-sm font-medium text-ink-500"
                : "text-sm font-medium text-amber-700"
          }
        >
          {status === "ready" ? (
            <CheckBadgeIcon aria-hidden="true" className="size-5" />
          ) : null}
          {statusLabel}
        </span>
      </div>
      {detail && status !== "ready" ? (
        <p className="mt-2 text-sm text-ink-500">{detail}</p>
      ) : null}
    </div>
  );
}

export { CheckRow };
export type { CheckStatus };
