import { useState, useEffect } from "react";

interface PromptInputProps {
  focused: boolean;
  onSubmit: (prompt: string) => void;
  onCancel: () => void;
}

export function PromptInput({ focused, onSubmit }: PromptInputProps) {
  const [value, setValue] = useState("");
  const [isReady, setIsReady] = useState(false);

  // Delay focus slightly to ensure component is fully mounted
  useEffect(() => {
    if (focused) {
      const timer = setTimeout(() => {
        setIsReady(true);
      }, 50);
      return () => clearTimeout(timer);
    } else {
      setIsReady(false);
    }
  }, [focused]);

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
          focused={isReady}
          onSubmit={handleSubmit}
        />
      </box>
    </box>
  );
}
