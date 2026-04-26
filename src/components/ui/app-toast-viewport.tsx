import { Toast } from "@base-ui/react/toast";
import { GH_CLI_TOAST_LOCK_VISIBLE } from "../../lib/gh-cli-toasts";

export function AppToastViewport() {
  const { toasts } = Toast.useToastManager();

  return (
    <Toast.Portal>
      <Toast.Viewport className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(28rem,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((toast) => {
          return (
            <Toast.Root
              className="pointer-events-auto rounded-lg bg-surface/80 backdrop-blur-sm p-4 shadow-xl"
              key={toast.id}
              toast={toast}
            >
              <Toast.Content className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Toast.Title className="text-sm font-semibold text-ink-900" />
                  <Toast.Description className="mt-1 text-xs leading-relaxed text-ink-600" />
                </div>

                {!GH_CLI_TOAST_LOCK_VISIBLE ? (
                  <Toast.Close
                    aria-label="Close"
                    className="rounded px-1 py-0.5 text-xs text-ink-600 transition hover:bg-canvas hover:text-ink-900"
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
