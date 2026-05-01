import type { KeyboardEvent } from "react";

type KeyboardShortcutKey = "mod" | "enter";

type KeyboardShortcut = {
  id: string;
  description: string;
  keys: KeyboardShortcutKey[];
};

const SUBMIT_COMMENT_SHORTCUT = {
  id: "review-comment.submit",
  description: "Submit comment",
  keys: ["mod", "enter"],
} satisfies KeyboardShortcut;

function isMacPlatform() {
  if (typeof navigator === "undefined") {
    return false;
  }

  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

function getShortcutKeyLabel(key: KeyboardShortcutKey) {
  if (key === "mod") {
    return isMacPlatform() ? "⌘" : "Ctrl";
  }

  return "↵";
}

function getShortcutLabels(shortcut: KeyboardShortcut) {
  return shortcut.keys.map(getShortcutKeyLabel);
}

function getShortcutAriaKeyShortcuts(shortcut: KeyboardShortcut) {
  return shortcut.keys
    .map((key) => {
      if (key === "mod") {
        return isMacPlatform() ? "Meta" : "Control";
      }

      return "Enter";
    })
    .join("+");
}

function isKeyboardShortcut(
  event: KeyboardEvent<HTMLElement>,
  shortcut: KeyboardShortcut,
) {
  if (event.isComposing || event.keyCode === 229) {
    return false;
  }

  const wantsEnter = shortcut.keys.includes("enter");
  const wantsMod = shortcut.keys.includes("mod");

  if (wantsEnter && event.key !== "Enter") {
    return false;
  }

  if (!wantsMod) {
    return true;
  }

  return isMacPlatform() ? event.metaKey : event.ctrlKey;
}

export {
  SUBMIT_COMMENT_SHORTCUT,
  getShortcutAriaKeyShortcuts,
  getShortcutLabels,
  isKeyboardShortcut,
};
export type { KeyboardShortcut };
