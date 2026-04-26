import type {
  ResizableHandleInteractionProps,
  ResizeOrientation,
} from "../../hooks/use-resizable-panel-group";

type ResizableHandleProps = ResizableHandleInteractionProps & {
  orientation: ResizeOrientation;
  label: string;
  className?: string;
};

function cx(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(" ");
}

function ResizableHandle({
  orientation,
  label,
  className,
  ...handleProps
}: ResizableHandleProps) {
  return (
    <div
      {...handleProps}
      aria-label={label}
      className={cx(
        "group relative z-20 shrink-0 touch-none outline-none",
        "focus-visible:ring-2 focus-visible:ring-ink-400 focus-visible:ring-offset-0",
        orientation === "horizontal"
          ? "w-2 cursor-col-resize"
          : "h-2 cursor-row-resize",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          "absolute rounded-full bg-ink-300 opacity-70 transition group-hover:bg-ink-500 group-hover:opacity-100 group-focus-visible:bg-ink-500 group-active:bg-ink-600",
          orientation === "horizontal"
            ? "inset-y-2 left-1/2 w-px -translate-x-1/2"
            : "inset-x-2 top-1/2 h-px -translate-y-1/2",
        )}
      />
    </div>
  );
}

export { ResizableHandle };
export type { ResizableHandleProps };
