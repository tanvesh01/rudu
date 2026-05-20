import type { ReactNode } from "react";

type AttachmentChipProps = {
  children: ReactNode;
  className?: string;
  icon: ReactNode;
  title?: string;
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function AttachmentChip({
  children,
  className,
  icon,
  title,
}: AttachmentChipProps) {
  return (
    <span
      className={cx(
        "inline-flex max-w-[16rem] select-none items-center gap-1 rounded border border-ink-200 bg-surface px-1 py-px align-baseline text-[11px] font-medium leading-4 text-ink-800 shadow-sm",
        className,
      )}
      contentEditable={false}
      title={title}
    >
      <span className="inline-flex size-3 shrink-0 items-center justify-center text-ink-500 [&>img]:size-3 [&>span]:size-3 [&>svg]:size-3">
        {icon}
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

export { AttachmentChip };
