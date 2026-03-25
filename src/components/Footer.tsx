import type { TreeNodeType } from "../domain/tree.js";

interface FooterProps {
  mode: "list" | "prompt" | "createWorktree";
  focusTarget?: "sessionList" | "chatInput" | "promptInput" | "createDialog";
  canSendMessage?: boolean;
  selectedNodeType?: TreeNodeType | null;
}

export function Footer({
  mode,
  focusTarget = "sessionList",
  canSendMessage = false,
  selectedNodeType = null,
}: FooterProps) {
  const getContent = () => {
    if (mode === "prompt") {
      return "Enter Submit | Escape Cancel";
    }

    if (mode === "createWorktree" || focusTarget === "createDialog") {
      return "Enter Submit | Escape Cancel";
    }

    if (focusTarget === "chatInput") {
      if (canSendMessage) {
        return "Enter Send | Tab Switch | Escape Unfocus";
      }
      return "Tab Switch | Escape Unfocus";
    }

    // When a worktree node is selected (not a session), disable chat/cancel affordances
    if (selectedNodeType === "worktree") {
      return "↑↓ Navigate | Ctrl+N New Worktree | Q Quit";
    }

    return "↑↓ Navigate | Enter Focus Chat | Ctrl+L Focus Chat | Ctrl+N New Worktree | Ctrl+C Cancel Selected | Q Quit";
  };

  return (
    <box
      height={1}
      backgroundColor="#000000"
      flexDirection="row"
    >
      <text
        content={getContent()}
        fg="#666666"
      />
    </box>
  );
}
