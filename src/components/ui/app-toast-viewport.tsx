import { Toast } from "@base-ui/react/toast";
import type { ToastObject } from "@base-ui/react/toast";
import { GH_CLI_TOAST_LOCK_VISIBLE } from "../../lib/gh-cli-toasts";
import type { AppToastData, AppToastPlacement } from "../../lib/toasts";

const DEFAULT_PLACEMENT: AppToastPlacement = "bottom-right";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function getToastRootClassName(toast: ToastObject<AppToastData>) {
  const placement = toast.data?.placement ?? DEFAULT_PLACEMENT;
  const placementClassName =
    placement === "bottom-center" ? "self-center" : "self-end";
  const animationClassName =
    "transform-gpu transition duration-200 ease-out data-[starting-style]:translate-y-2 data-[starting-style]:opacity-0 data-[ending-style]:translate-y-2 data-[ending-style]:opacity-0";

  if (toast.data?.variant === "patch-loading") {
    return cx(
      "pointer-events-auto rounded-md bg-black/85 px-3 py-2 shadow-lg backdrop-blur-sm dark:bg-surface/80",
      animationClassName,
      placementClassName,
    );
  }

  return cx(
    "pointer-events-auto rounded-lg bg-surface/80 p-4 shadow-xl backdrop-blur-sm",
    animationClassName,
    placementClassName,
  );
}

function getToastTitleClassName(toast: ToastObject<AppToastData>) {
  if (toast.data?.variant === "patch-loading") {
    return "text-xs font-medium text-white dark:text-white";
  }

  return "text-sm font-semibold text-ink-900 dark:text-white";
}

function getToastDescriptionClassName(toast: ToastObject<AppToastData>) {
  if (toast.data?.variant === "patch-loading") {
    return "mt-1 text-[11px] leading-relaxed text-white/80 dark:text-white";
  }

  return "mt-1 text-xs leading-relaxed text-ink-600 dark:text-white";
}

export function AppToastViewport() {
  const { toasts } = Toast.useToastManager<AppToastData>();

  return (
    <Toast.Portal>
      <Toast.Viewport className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col gap-2">
        {toasts.map((toast) => {
          return (
            <Toast.Root
              className={getToastRootClassName(toast)}
              key={toast.id}
              toast={toast}
            >
              <Toast.Content className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Toast.Title className={getToastTitleClassName(toast)} />
                  {toast.description ? (
                    <Toast.Description
                      className={getToastDescriptionClassName(toast)}
                    />
                  ) : null}
                </div>

                {!GH_CLI_TOAST_LOCK_VISIBLE && !toast.data?.hideClose ? (
                  <Toast.Close
                    aria-label="Close"
                    className={cx(
                      "rounded px-1 py-0.5 text-xs transition",
                      toast.data?.variant === "patch-loading"
                        ? "text-white/70 hover:bg-white/10 hover:text-white dark:text-white dark:hover:bg-canvas dark:hover:text-white"
                        : "text-ink-600 hover:bg-canvas hover:text-ink-900 dark:text-white dark:hover:bg-canvas dark:hover:text-white",
                    )}
                  >
                    x
                  </Toast.Close>
                ) : null}
              </Toast.Content>
            </Toast.Root>
          );
        })}
      </Toast.Viewport>
    </Toast.Portal>
  );
}
