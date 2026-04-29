import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Command } from "cmdk";
import type { ComponentProps, ReactNode } from "react";

function joinClassNames(...classNames: Array<string | undefined>) {
  return classNames.filter(Boolean).join(" ");
}

type CommandRootProps = ComponentProps<typeof Command>;

type CommandMenuDialogProps = {
  children?: ReactNode;
  className?: string;
  container?: HTMLElement;
  contentClassName?: string;
  defaultOpen?: boolean;
  defaultValue?: CommandRootProps["defaultValue"];
  disablePointerSelection?: CommandRootProps["disablePointerSelection"];
  filter?: CommandRootProps["filter"];
  label?: CommandRootProps["label"];
  loop?: CommandRootProps["loop"];
  modal?: boolean | "trap-focus";
  onOpenChange?: (open: boolean) => void;
  onValueChange?: CommandRootProps["onValueChange"];
  open?: boolean;
  overlayClassName?: string;
  shouldFilter?: CommandRootProps["shouldFilter"];
  value?: CommandRootProps["value"];
  vimBindings?: CommandRootProps["vimBindings"];
};

function CommandMenuDialog({
  children,
  className,
  container,
  contentClassName,
  defaultOpen,
  defaultValue,
  disablePointerSelection,
  filter,
  label,
  loop,
  modal,
  onOpenChange,
  onValueChange,
  open,
  overlayClassName,
  shouldFilter,
  value,
  vimBindings,
}: CommandMenuDialogProps) {
  return (
    <DialogPrimitive.Root
      defaultOpen={defaultOpen}
      modal={modal}
      onOpenChange={(nextOpen) => onOpenChange?.(nextOpen)}
      open={open}
    >
      <DialogPrimitive.Portal container={container}>
        <DialogPrimitive.Backdrop
          className={joinClassNames(
            "fixed inset-0 z-50 bg-black/45 transition-opacity duration-150 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none",
            overlayClassName,
          )}
        />
        <DialogPrimitive.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <DialogPrimitive.Popup
            aria-label={label}
            className={joinClassNames(
              "w-[min(640px,calc(100vw-2rem))] max-h-[min(72vh,620px)] overflow-hidden rounded-xl border border-neutral-400 bg-surface/90 shadow-xl outline-none backdrop-blur-xl transition-[opacity,transform] duration-150 ease-out data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none supports-[backdrop-filter]:bg-surface/75 dark:border-neutral-700",
              contentClassName,
            )}
          >
            <Command
              className={joinClassNames(
                "flex h-full min-h-0 flex-col bg-transparent text-ink-900",
                className,
              )}
              defaultValue={defaultValue}
              disablePointerSelection={disablePointerSelection}
              filter={filter}
              label={label}
              loop={loop}
              onValueChange={onValueChange}
              shouldFilter={shouldFilter}
              value={value}
              vimBindings={vimBindings}
            >
              {children}
            </Command>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function CommandMenuInput({
  className,
  ...props
}: ComponentProps<typeof Command.Input>) {
  return (
    <Command.Input
      className={joinClassNames(
        "w-full border-b border-neutral-300/50 bg-surface/25 px-4 py-3 outline-none transition placeholder:text-neutral-500 disabled:cursor-default disabled:opacity-60 dark:border-neutral-600/40 dark:bg-surface/20",
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
        "flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto bg-transparent px-2 py-3",
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
        "w-full cursor-pointer rounded-lg bg-surface/25 px-2 py-2.5 text-left outline-none transition hover:bg-surface/50 aria-selected:bg-surface/70 data-[selected=true]:bg-surface/70 aria-disabled:cursor-default aria-disabled:opacity-60 dark:bg-surface/20 dark:hover:bg-surface/45 dark:aria-selected:bg-surface/65 dark:data-[selected=true]:bg-neutral-700",
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
