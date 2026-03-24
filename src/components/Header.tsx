interface HeaderProps {
  mode?: "list" | "prompt";
}

export function Header({ mode }: HeaderProps) {
  return (
    <box
      flexDirection="row"
      height={3}
      backgroundColor="#000000"
      alignItems="center"
    >
      <text fg="#ffffff">Rudu</text>
      <text content=" - AI Coding Agent Sessions" fg="#888888" />
      {mode === "prompt" && (
        <box marginLeft={2}>
          <text content="[PROMPT MODE]" fg="#cccccc" />
        </box>
      )}
    </box>
  );
}
