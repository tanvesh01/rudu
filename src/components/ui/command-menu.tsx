import { Command } from "cmdk";
import type { ComponentProps } from "react";

function joinClassNames(...classNames: Array<string | undefined>) {
  return classNames.filter(Boolean).join(" ");
}

function CommandMenuDialog({
  className,
  contentClassName,
  overlayClassName,
  ...props
}: ComponentProps<typeof Command.Dialog>) {
  return (
    <Command.Dialog
      className={joinClassNames(
        "flex min-h-0 flex-col bg-surface text-ink-900",
        className,
      )}
      contentClassName={joinClassNames(
        "fixed left-1/2 top-1/2 z-50 w-[min(640px,calc(100vw-2rem))] max-h-[min(72vh,620px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-neutral-400 bg-surface shadow-xl outline-none dark:border-neutral-700",
        contentClassName,
      )}
      overlayClassName={joinClassNames(
        "fixed inset-0 z-50 bg-slate-950/50",
        overlayClassName,
      )}
      {...props}
    />
  );
}

function CommandMenuInput({
  className,
  ...props
}: ComponentProps<typeof Command.Input>) {
  return (
    <Command.Input
      className={joinClassNames(
        "w-full border-b border-neutral-200 bg-surface px-4 py-3 outline-none transition placeholder:text-neutral-400 disabled:cursor-default disabled:opacity-60 dark:border-neutral-700",
        className,
      )}
      {...props}
    />
  );
}

function CommandMenuList({
  className,
  ...props
}: ComponentProps<typeof Command.List>) {
  return (
    <Command.List
      className={joinClassNames(
        "flex max-h-[340px] flex-col gap-1 overflow-y-auto px-2 py-3",
        className,
      )}
      {...props}
    />
  );
}

function CommandMenuItem({
  className,
  ...props
}: ComponentProps<typeof Command.Item>) {
  return (
    <Command.Item
      className={joinClassNames(
        "w-full rounded-lg bg-surface px-2 py-2.5 text-left outline-none transition hover:bg-canvas aria-selected:bg-canvasDark data-[selected=true]:bg-canvasDark aria-disabled:cursor-default aria-disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

function CommandMenuEmpty({
  className,
  ...props
}: ComponentProps<typeof Command.Empty>) {
  return (
    <Command.Empty
      className={joinClassNames("px-2 py-3 text-sm text-ink-500", className)}
      {...props}
    />
  );
}

function CommandMenuLoading({
  className,
  ...props
}: ComponentProps<typeof Command.Loading>) {
  return (
    <Command.Loading
      className={joinClassNames("px-2 py-3 text-sm text-ink-500", className)}
      {...props}
    />
  );
}

const CommandMenu = {
  Dialog: CommandMenuDialog,
  Input: CommandMenuInput,
  List: CommandMenuList,
  Item: CommandMenuItem,
  Empty: CommandMenuEmpty,
  Loading: CommandMenuLoading,
};

export { CommandMenu };
