import { useState } from "react";
import type { SessionSnapshot } from "../services/SessionManager.js";

interface SessionChatInputProps {
  session: SessionSnapshot | null;
  focused: boolean;
  onSubmit: (text: string) => void | Promise<void>;
}

export function SessionChatInput({ session, focused, onSubmit }: SessionChatInputProps) {
  const [value, setValue] = useState("");

  const canSend = session?.canSendFollowUp ?? false;

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || !canSend) return;

    setValue("");
    void Promise.resolve(onSubmit(trimmed)).catch(() => {
      // Keep input responsive even when backend send fails.
    });
  };

  // Determine placeholder based on session state
  const getPlaceholder = () => {
    if (!session) return "Press Ctrl+N to start a new session...";
    if (!canSend) {
      if (session.runtimeType !== "pi-sdk") return "Only PI sessions support chat...";
      if (session.status !== "running") return `Session is ${session.status}. Waiting to start...`;
      return "Cannot send messages to this session...";
    }
    if (session.transcriptSummary.retainedMessages === 0) {
      return "Type the first message to start this session...";
    }
    return "Type a message...";
  };

  return (
    <box
      flexDirection="row"
      height={3}
      padding={1}
      backgroundColor="#1a1a1a"
      alignItems="center"
    >
      <text content="> " fg="#888888" />
      <box flexGrow={1}>
        <input
          value={value}
          onChange={setValue}
          placeholder={getPlaceholder()}
          focused={focused && canSend}
          onSubmit={handleSubmit}
          backgroundColor="#2a2a2a"
          focusedBackgroundColor="#333333"
          textColor="#cccccc"
          placeholderColor="#666666"
          cursorColor="#ffffff"
        />
      </box>
    </box>
  );
}
