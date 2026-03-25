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
      paddingLeft={2}
    >
      <text fg="#ffffff">Rudu</text>
      {mode === "prompt" && (
        <box marginLeft={2}>
          <text content="[PROMPT MODE]" fg="#cccccc" />
        </box>
      )}
    </box>
  );
}
