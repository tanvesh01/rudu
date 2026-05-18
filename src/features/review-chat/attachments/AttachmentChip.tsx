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
        "inline-flex max-w-[18rem] select-none items-center gap-1.5 rounded-md border border-ink-200 bg-surface px-1.5 py-0.5 align-baseline text-xs font-medium leading-5 text-ink-800 shadow-sm",
        className,
      )}
      contentEditable={false}
      title={title}
    >
      <span className="inline-flex size-3.5 shrink-0 items-center justify-center text-ink-500">
        {icon}
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

export { AttachmentChip };
