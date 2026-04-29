import type { KeyboardShortcut as KeyboardShortcutDefinition } from "../../lib/keyboard-shortcuts";
import { getShortcutLabels } from "../../lib/keyboard-shortcuts";

type KeyboardShortcutProps = {
  shortcut: KeyboardShortcutDefinition;
  className?: string;
};

function KeyboardShortcut({ shortcut, className = "" }: KeyboardShortcutProps) {
  return (
    <span
      className={["inline-flex items-center gap-1", className].join(" ")}
      title={shortcut.description}
    >
      {getShortcutLabels(shortcut).map((label) => (
        <kbd
          className="rounded border border-ink-300 bg-surface px-1 py-0.5 font-mono text-[10px] font-medium leading-none text-ink-600 shadow-sm dark:bg-canvas"
          key={label}
        >
          {label}
        </kbd>
      ))}
    </span>
  );
}

export { KeyboardShortcut };
export type { KeyboardShortcutProps };
