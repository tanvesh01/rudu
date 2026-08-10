import type { DiffStyle } from "../../hooks/use-diff-style";

// Icons lifted from https://diffs.com (Split / Stacked toggle).
function SplitIcon() {
  return (
    <svg
      fill="currentcolor"
      height="14"
      viewBox="0 0 16 16"
      width="14"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M14 0H8.5v16H14a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2m-1.5 6.5v1h1a.5.5 0 0 1 0 1h-1v1a.5.5 0 0 1-1 0v-1h-1a.5.5 0 0 1 0-1h1v-1a.5.5 0 0 1 1 0" />
      <path
        d="M2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5.5V0zm.5 7.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1 0-1"
        opacity="0.3"
      />
    </svg>
  );
}

function StackedIcon() {
  return (
    <svg
      fill="currentcolor"
      height="14"
      viewBox="0 0 16 16"
      width="14"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        clipRule="evenodd"
        d="M16 14a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V8.5h16zm-8-4a.5.5 0 0 0-.5.5v1h-1a.5.5 0 0 0 0 1h1v1a.5.5 0 0 0 1 0v-1h1a.5.5 0 0 0 0-1h-1v-1A.5.5 0 0 0 8 10"
        fillRule="evenodd"
      />
      <path
        clipRule="evenodd"
        d="M14 0a2 2 0 0 1 2 2v5.5H0V2a2 2 0 0 1 2-2zM6.5 3.5a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1z"
        fillRule="evenodd"
        opacity="0.4"
      />
    </svg>
  );
}

type DiffStyleToggleProps = {
  value: DiffStyle;
  onChange: (style: DiffStyle) => void;
};

function DiffStyleToggle({ value, onChange }: DiffStyleToggleProps) {
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-lg bg-canvasDark p-0.5"
      role="group"
    >
      <button
        aria-pressed={value === "split"}
        className={
          value === "split"
            ? "flex h-6 w-7 items-center justify-center rounded-md bg-surface text-ink-900 shadow-xs"
            : "flex h-6 w-7 items-center justify-center rounded-md text-ink-500 transition hover:text-ink-900"
        }
        onClick={() => onChange("split")}
        title="Split diff layout"
        type="button"
      >
        <SplitIcon />
      </button>
      <button
        aria-pressed={value === "unified"}
        className={
          value === "unified"
            ? "flex h-6 w-7 items-center justify-center rounded-md bg-surface text-ink-900 shadow-xs"
            : "flex h-6 w-7 items-center justify-center rounded-md text-ink-500 transition hover:text-ink-900"
        }
        onClick={() => onChange("unified")}
        title="Stacked diff layout"
        type="button"
      >
        <StackedIcon />
      </button>
    </div>
  );
}

type SidebarToggleProps = {
  open: boolean;
  onClick: () => void;
  side: "left" | "right";
};

function SidebarToggle({ open, onClick, side }: SidebarToggleProps) {
  const label = `${open ? "Hide" : "Show"} ${side} sidebar`;

  return (
    <button
      aria-label={label}
      aria-pressed={open}
      className="flex size-7 items-center justify-center rounded-md text-ink-500 transition hover:bg-canvasDark hover:text-ink-900"
      onClick={onClick}
      title={label}
      type="button"
    >
      <svg
        fill="none"
        height="16"
        viewBox="0 0 16 16"
        width="16"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect
          height="13"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.5"
          width="13"
          x="1.5"
          y="1.5"
        />
        <path
          d={`M${side === "left" ? 6 : 10} 2v12`}
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d={`M${side === "left" ? 4 : 12} 4.5v7`}
          opacity={open ? "0.8" : "0.25"}
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
    </button>
  );
}

function LeftSidebarToggle(props: Omit<SidebarToggleProps, "side">) {
  return <SidebarToggle {...props} side="left" />;
}

function RightSidebarToggle(props: Omit<SidebarToggleProps, "side">) {
  return <SidebarToggle {...props} side="right" />;
}

export { DiffStyleToggle, LeftSidebarToggle, RightSidebarToggle };
