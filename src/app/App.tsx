import { useState, useCallback, useEffect, useRef } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { SessionManager } from "../services/SessionManager.js";
import { useSessionStore } from "../hooks/useSessionStore.js";
import { Header } from "../components/Header.js";
import { SessionList } from "../components/SessionList.js";
import { LogPane } from "../components/LogPane.js";
import { PromptInput } from "../components/PromptInput.js";
import { Footer } from "../components/Footer.js";

type AppMode = "list" | "prompt";

export function App() {
  const renderer = useRenderer();
  const [mode, setMode] = useState<AppMode>("list");
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
  const { sessions, selectedSessionId, selectSession, cancelSession, getSessionLogs, getSessionTranscripts } =
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

  // Keyboard shortcuts
  useKeyboard((key) => {
    // Ctrl+N - New session (prompt mode)
    if (key.ctrl && key.name === "n") {
      setMode("prompt");
      return;
    }

    // Ctrl+C - Cancel selected session (only in list mode)
    if (key.ctrl && key.name === "c" && mode === "list") {
      handleCancelSession();
      return;
    }

    // Escape - Return to list mode
    if (key.name === "escape") {
      if (mode === "prompt") {
        setMode("list");
      }
      return;
    }

    // Q - Quit
    if (key.name === "q" && mode === "list") {
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
            focused={mode === "list"}
            onSelect={selectSession}
          />
        </box>

        {/* Log Pane */}
        <box flexGrow={1} flexDirection="column">
          <LogPane session={selectedSession} logs={selectedLogs} transcripts={selectedTranscripts} />
        </box>
      </box>

      {/* Prompt Input - shown in prompt mode */}
      {mode === "prompt" && (
        <PromptInput
          focused={true}
          onSubmit={handleCreateSession}
          onCancel={() => setMode("list")}
        />
      )}

      <Footer mode={mode} />
    </box>
  );
}
