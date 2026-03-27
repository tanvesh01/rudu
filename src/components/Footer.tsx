interface FooterProps {
  mode: "list" | "prompt" | "createWorktree";
  focusTarget?: "sessionList" | "chatInput" | "promptInput" | "createDialog";
  canSendMessage?: boolean;
  hasSelectedSession?: boolean;
}

export function Footer({
  mode,
  focusTarget = "sessionList",
  canSendMessage = false,
  hasSelectedSession = false,
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

    // When no session is selected, disable chat/cancel affordances
    if (!hasSelectedSession) {
      return "↑↓ Navigate | Ctrl+A Archive | Ctrl+D Delete | Ctrl+N New Worktree | Q Quit";
    }

    return "↑↓ Navigate | Ctrl+L Focus Chat | Ctrl+N New Worktree | Ctrl+C Cancel Selected | Q Quit";
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
