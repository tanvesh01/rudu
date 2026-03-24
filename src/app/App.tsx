import { useState, useCallback, useEffect, useRef } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { SessionManager } from "../services/SessionManager.js";
import { useSessionStore } from "../hooks/useSessionStore.js";
import { Header } from "../components/Header.js";
import { SessionList } from "../components/SessionList.js";
import { LogPane } from "../components/LogPane.js";
import { PromptInput } from "../components/PromptInput.js";
import { SessionChatInput } from "../components/SessionChatInput.js";
import { Footer } from "../components/Footer.js";

type AppMode = "list" | "prompt";
type FocusTarget = "sessionList" | "chatInput" | "promptInput";

export function App() {
  const renderer = useRenderer();
  const [mode, setMode] = useState<AppMode>("list");
  const [focusTarget, setFocusTarget] = useState<FocusTarget>("sessionList");
  const sessionManagerRef = useRef<SessionManager | null>(null);

  // Initialize SessionManager once
  if (!sessionManagerRef.current) {
    sessionManagerRef.current = new SessionManager();
  }

  const sessionManager = sessionManagerRef.current;

  // Add mock sessions for UI testing (remove in production)
  useEffect(() => {
    // Only add mock data if no sessions exist
    if (sessionManager.listSessions().length === 0) {
      const mockSessionId = "mock-session-1";
      sessionManager.queuePiSession({
        id: mockSessionId,
        title: "Refactor authentication middleware",
        prompt: "Refactor the auth middleware to use JWT tokens",
        cwd: process.cwd(),
        metadata: { prompt: "Refactor the auth middleware to use JWT tokens" },
      });

      // Add another mock session
      sessionManager.queuePiSession({
        id: "mock-session-2",
        title: "Add unit tests for user service",
        prompt: "Write comprehensive unit tests for the user service",
        cwd: process.cwd(),
        metadata: { prompt: "Write comprehensive unit tests for the user service" },
      });
    }
  }, [sessionManager]);
  const { sessions, selectedSessionId, selectSession, cancelSession, sendSessionMessage, getSessionLogs, getSessionTranscripts } =
    useSessionStore(sessionManager);

  const selectedSession = sessions.find((s) => s.id === selectedSessionId) ?? null;
  const selectedLogs = selectedSessionId ? getSessionLogs(selectedSessionId) : [];
  const selectedTranscripts = selectedSessionId ? getSessionTranscripts(selectedSessionId) : [];

  // Create a new PI SDK session from prompt
  const handleCreateSession = useCallback(
    (prompt: string) => {
      const id = crypto.randomUUID();
      sessionManager.queuePiSession({
        id,
        title: prompt.slice(0, 50) + (prompt.length > 50 ? "..." : ""),
        prompt,
        cwd: process.cwd(),
        metadata: { prompt },
      });
      setMode("list");
      // Auto-select the new session
      selectSession(id);
    },
    [sessionManager, selectSession]
  );

  // Cancel selected session
  const handleCancelSession = useCallback(() => {
    if (selectedSessionId) {
      cancelSession(selectedSessionId);
    }
  }, [selectedSessionId, cancelSession]);

  // Send message to selected session
  const handleSendMessage = useCallback(
    async (text: string) => {
      if (selectedSessionId && selectedSession?.canSendFollowUp) {
        await sendSessionMessage(selectedSessionId, text);
      }
    },
    [selectedSessionId, selectedSession, sendSessionMessage]
  );

  // Keyboard shortcuts
  useKeyboard((key) => {
    // Ctrl+N - New session (prompt mode)
    if (key.ctrl && key.name === "n") {
      setMode("prompt");
      setFocusTarget("promptInput");
      return;
    }

    // Ctrl+C - Cancel selected session (only when not in prompt mode)
    if (key.ctrl && key.name === "c" && mode !== "prompt") {
      handleCancelSession();
      return;
    }

    // Tab - Toggle focus between session list and chat input
    if (key.name === "tab" && mode === "list" && selectedSession?.canSendFollowUp) {
      setFocusTarget((prev) => (prev === "sessionList" ? "chatInput" : "sessionList"));
      return;
    }

    // Escape - Return to list mode / unfocus chat
    if (key.name === "escape") {
      if (mode === "prompt") {
        setMode("list");
        setFocusTarget("sessionList");
      } else if (focusTarget === "chatInput") {
        setFocusTarget("sessionList");
      }
      return;
    }

    // Q - Quit (only when session list is focused)
    if (key.name === "q" && mode === "list" && focusTarget === "sessionList") {
      void sessionManager.shutdown().then(() => {
        renderer.destroy();
      });
      return;
    }
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      void sessionManager.dispose();
    };
  }, [sessionManager]);

  return (
    <box flexDirection="column" width="100%" height="100%">
      <Header mode={mode} />

      <box flexGrow={1} flexDirection="row">
        {/* Session List */}
        <box width={40} flexDirection="column">
          <SessionList
            sessions={sessions}
            selectedId={selectedSessionId}
            focused={mode === "list" && focusTarget === "sessionList"}
            onSelect={(id) => {
              selectSession(id);
              setFocusTarget("sessionList");
            }}
          />
        </box>

        {/* Chat Area: Log Pane + Chat Input */}
        <box flexGrow={1} flexDirection="column">
          <LogPane session={selectedSession} logs={selectedLogs} transcripts={selectedTranscripts} />
          <SessionChatInput
            session={selectedSession}
            focused={mode === "list" && focusTarget === "chatInput"}
            onSubmit={handleSendMessage}
          />
        </box>
      </box>

      {/* Prompt Input - shown in prompt mode */}
      {mode === "prompt" && (
        <PromptInput
          focused={focusTarget === "promptInput"}
          onSubmit={handleCreateSession}
          onCancel={() => {
            setMode("list");
            setFocusTarget("sessionList");
          }}
        />
      )}

      <Footer 
        mode={mode} 
        focusTarget={focusTarget}
        canSendMessage={selectedSession?.canSendFollowUp ?? false}
      />
    </box>
  );
}
