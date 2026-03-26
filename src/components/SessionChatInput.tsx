import { useState } from "react";
import type { SessionSnapshot } from "../services/SessionManager.js";

interface SessionChatInputProps {
  session: SessionSnapshot | null;
  focused: boolean;
  onSubmit: (text: string) => void | Promise<void>;
}

export function SessionChatInput({
  session,
  focused,
  onSubmit,
}: SessionChatInputProps) {
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
      if (session.runtimeType !== "pi-sdk")
        return "Only PI sessions support chat...";
      if (session.status !== "running")
        return `Session is ${session.status}. Waiting to start...`;
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
      paddingLeft={2}
      paddingRight={2}
      backgroundColor="#000000"
      alignItems="center"
    >
      <text content="> " fg="#888888" />
      <input
        value={value}
        onChange={setValue}
        placeholder={getPlaceholder()}
        focused={focused && canSend}
        onSubmit={handleSubmit}
        backgroundColor="#1a1a1a"
        focusedBackgroundColor="#2a2a2a"
        textColor="#cccccc"
        placeholderColor="#555555"
        cursorColor="#ffffff"
        flexGrow={1}
      />
    </box>
  );
}
