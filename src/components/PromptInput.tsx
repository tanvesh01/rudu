import { useState } from "react";

interface PromptInputProps {
  focused: boolean;
  onSubmit: (prompt: string) => void;
  onCancel: () => void;
}

export function PromptInput({ focused, onSubmit }: PromptInputProps) {
  const [value, setValue] = useState("");

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (trimmed) {
      onSubmit(trimmed);
      setValue("");
    }
  };

  return (
    <box
      flexDirection="row"
      height={3}
      padding={1}
      backgroundColor="#000000"
      alignItems="center"
    >
      <text content="> " fg="#cccccc" />
      <box flexGrow={1}>
        <input
          value={value}
          onChange={setValue}
          placeholder="Enter prompt for coding agent..."
          focused={focused}
          onSubmit={handleSubmit}
        />
      </box>
    </box>
  );
}
