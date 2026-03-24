interface FooterProps {
  mode: "list" | "prompt";
}

export function Footer({ mode }: FooterProps) {
  return (
    <box
      height={1}
      backgroundColor="#000000"
      flexDirection="row"
    >
      <text 
        content={
          mode === "list"
            ? "↑↓ Navigate | Enter Select | Ctrl+N New | Ctrl+C Cancel Selected | Q Quit"
            : "Enter Submit | Escape Cancel"
        }
        fg="#666666"
      />
    </box>
  );
}
