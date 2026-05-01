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
          className="rounded font-mono text font-medium leading-none text-neutral-200 shadow-sm"
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
