import * as React from "react";
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";

function cx(...classes: Array<string | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function toClassName(className: unknown) {
  return typeof className === "string" ? className : undefined;
}

function AlertDialog(props: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root {...props} />;
}

function AlertDialogTrigger(
  props: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>,
) {
  return <AlertDialogPrimitive.Trigger {...props} />;
}

function AlertDialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Popup>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-slate-950/50" />
      <AlertDialogPrimitive.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <AlertDialogPrimitive.Popup
          className={cx(
            "flex max-h-[80vh] w-full max-w-[520px] flex-col rounded-2xl border border-ink-300 bg-surface p-[18px] shadow-dialog",
            toClassName(className),
          )}
          {...props}
        >
          {children}
        </AlertDialogPrimitive.Popup>
      </AlertDialogPrimitive.Viewport>
    </AlertDialogPrimitive.Portal>
  );
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cx("flex flex-col gap-1.5", toClassName(className))} {...props} />;
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cx("flex justify-end gap-2.5", toClassName(className))} {...props} />;
}

function AlertDialogTitle(
  { className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Title>,
) {
  return (
    <AlertDialogPrimitive.Title
      className={cx("m-0 text-lg font-bold", toClassName(className))}
      {...props}
    />
  );
}

function AlertDialogDescription(
  {
    className,
    ...props
  }: React.ComponentProps<typeof AlertDialogPrimitive.Description>,
) {
  return (
    <AlertDialogPrimitive.Description
      className={cx("m-0 text-sm text-ink-600", toClassName(className))}
      {...props}
    />
  );
}

function AlertDialogCancel(
  { className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Close>,
) {
  return (
    <AlertDialogPrimitive.Close
      className={cx(
        "rounded-xl border border-ink-300 bg-surface px-3.5 py-2.5 text-ink-900 transition hover:border-zinc-400 hover:bg-canvas disabled:cursor-default disabled:opacity-60",
        toClassName(className),
      )}
      {...props}
    />
  );
}

function AlertDialogAction({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      className={cx(
        "rounded-xl border border-brand-600 bg-brand-600 px-3.5 py-2.5 text-white transition hover:bg-brand-500 disabled:cursor-default disabled:opacity-60 dark:border-ink-200 dark:bg-ink-200 dark:text-ink-900 dark:hover:bg-ink-300",
        toClassName(className),
      )}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
};
