interface FooterProps {
  mode: "list" | "prompt";
  focusTarget?: "sessionList" | "chatInput" | "promptInput";
  canSendMessage?: boolean;
}

export function Footer({ mode, focusTarget = "sessionList", canSendMessage = false }: FooterProps) {
  const getContent = () => {
    if (mode === "prompt") {
      return "Enter Submit | Escape Cancel";
    }

    if (focusTarget === "chatInput") {
      if (canSendMessage) {
        return "Enter Send | Tab Switch | Escape Unfocus";
      }
      return "Tab Switch | Escape Unfocus";
    }

    return "↑↓ Navigate | Enter Focus Chat | Ctrl+L Focus Chat | Ctrl+N New | Ctrl+C Cancel Selected | Q Quit";
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
