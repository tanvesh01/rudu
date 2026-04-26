import { getCurrentWindow } from "@tauri-apps/api/window";

type WindowDragRegionProps = {
  className?: string;
};

function cx(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(" ");
}

function WindowDragRegion({ className }: WindowDragRegionProps) {
  const appWindow = getCurrentWindow();

  return (
    <div
      aria-hidden="true"
      className={cx(
        "h-8 shrink-0 cursor-grab active:cursor-grabbing",
        className,
      )}
      data-tauri-drag-region
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        if (event.detail === 2) {
          void appWindow.toggleMaximize();
          return;
        }
        void appWindow.startDragging();
      }}
    />
  );
}

export { WindowDragRegion };
export type { WindowDragRegionProps };
