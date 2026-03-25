import { useState, useCallback, useEffect, useRef } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { SessionManager } from "../services/SessionManager.js";
import { useSessionStore } from "../hooks/useSessionStore.js";
import { Header } from "../components/Header.js";
import { SessionList } from "../components/SessionList.js";
import { LogPane } from "../components/LogPane.js";
import { SessionChatInput } from "../components/SessionChatInput.js";
import { Footer } from "../components/Footer.js";
import { InMemorySessionRepository } from "../services/persistence/JsonlSessionRepository.js";
import { SyncJsonlSessionRepository } from "../services/persistence/SyncJsonlSessionRepository.js";
import { InMemoryWorktreeRepository } from "../services/persistence/SyncJsonlWorktreeRepository.js";
import { SyncJsonlWorktreeRepository } from "../services/persistence/SyncJsonlWorktreeRepository.js";
import type { SyncJsonlSessionRepositoryOptions } from "../services/persistence/SyncJsonlSessionRepository.js";
import {
  detectRepoContext,
  isSupportedRepo,
  type RepoContextResult,
} from "../services/repo/RepoContext.js";

type FocusTarget = "sessionList" | "chatInput";

/**
 * Unsupported state UI shown when Rudu is launched outside a git repository.
 */
function UnsupportedState({ reason }: { reason: string }) {
  return (
    <box flexDirection="column" width="100%" height="100%">
      <box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
        <text content="Unsupported Directory" fg="red" />
        <text content={reason} fg="gray" marginTop={1} />
        <text content="Rudu must be launched from within a git repository." fg="gray" marginTop={1} />
      </box>
    </box>
  );
}

export function App() {
  const renderer = useRenderer();
  const [focusTarget, setFocusTarget] = useState<FocusTarget>("sessionList");
  const sessionManagerRef = useRef<SessionManager | null>(null);
  const repoContextRef = useRef<RepoContextResult | null>(null);

  // Initialize repo context once at startup
  if (!repoContextRef.current) {
    const isTestEnvironment =
      process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test";

    if (isTestEnvironment) {
      // In tests, simulate a supported repo context
      repoContextRef.current = {
        type: "supported",
        repoRoot: process.cwd(),
        defaultBranch: "main",
      };
    } else {
      repoContextRef.current = detectRepoContext();
    }
  }

  const repoContext = repoContextRef.current;

  // Show unsupported state if not in a git repository
  if (!isSupportedRepo(repoContext)) {
    return <UnsupportedState reason={repoContext.reason} />;
  }

  // Initialize SessionManager once with JSONL persistence
  if (!sessionManagerRef.current) {
    const isTestEnvironment =
      process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test";

    const sessionRepository = isTestEnvironment
      ? new InMemorySessionRepository()
      : new SyncJsonlSessionRepository({
          projectRoot: repoContext.repoRoot,
        });
    
    const worktreeRepository = isTestEnvironment
      ? new InMemoryWorktreeRepository()
      : new SyncJsonlWorktreeRepository({
          projectRoot: repoContext.repoRoot,
        });
    
    sessionManagerRef.current = new SessionManager({ 
      repository: sessionRepository,
      worktreeRepository: worktreeRepository,
    });

    // Rehydrate persisted sessions from JSONL
    // Legacy sessions without worktreeId are ignored
    // Orphaned sessions (unknown worktreeId) are marked as recovered
    sessionManagerRef.current.rehydrateFromPersistence();
  }

  const sessionManager = sessionManagerRef.current;

  const {
    sessions,
    selectedSessionId,
    selectSession,
    cancelSession,
    sendSessionMessage,
    hydrateSessionHistory,
    getSessionLogs,
    getSessionTranscripts,
  } = useSessionStore(sessionManager);

  const selectedSession =
    sessions.find((s) => s.id === selectedSessionId) ?? null;
  const selectedLogs = selectedSessionId
    ? getSessionLogs(selectedSessionId)
    : [];
  const selectedTranscripts = selectedSessionId
    ? getSessionTranscripts(selectedSessionId)
    : [];

  // Create a new PI SDK session and focus its chat input
  const handleCreateSession = useCallback(() => {
    const id = crypto.randomUUID();
    sessionManager.queuePiSession({
      id,
      title: "New session",
      prompt: "",
      cwd: process.cwd(),
    });
    selectSession(id);
    setFocusTarget("chatInput");
  }, [sessionManager, selectSession]);

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
    [selectedSessionId, selectedSession, sendSessionMessage],
  );

  useEffect(() => {
    if (!selectedSessionId) return;
    void hydrateSessionHistory(selectedSessionId).catch(() => {
      // Ignore lazy history hydration failures.
    });
  }, [selectedSessionId, hydrateSessionHistory]);

  // Keyboard shortcuts
  useKeyboard((key) => {
    // Ctrl+N - New session
    if (key.ctrl && key.name === "n") {
      handleCreateSession();
      return;
    }

    // Ctrl+C - Cancel selected session
    if (key.ctrl && key.name === "c") {
      handleCancelSession();
      return;
    }

    // Ctrl+L - Focus chat input for selected session
    if (key.ctrl && key.name === "l" && selectedSessionId) {
      setFocusTarget("chatInput");
      return;
    }

    // Enter - Focus chat input from session list
    if (
      key.name === "enter" &&
      focusTarget === "sessionList" &&
      selectedSessionId
    ) {
      setFocusTarget("chatInput");
      return;
    }

    // Tab - Toggle focus between session list and chat input
    if (key.name === "tab" && selectedSessionId) {
      setFocusTarget((prev) =>
        prev === "sessionList" ? "chatInput" : "sessionList",
      );
      return;
    }

    // Escape - Unfocus chat
    if (key.name === "escape") {
      if (focusTarget === "chatInput") {
        setFocusTarget("sessionList");
      }
      return;
    }

    // Q - Quit (only when session list is focused)
    if (key.name === "q" && focusTarget === "sessionList") {
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
      <Header mode="list" />

      <box flexGrow={1} flexDirection="row">
        {/* Session List */}
        <box
          width={40}
          height="100%"
          backgroundColor="#1a1a1a"
          flexDirection="column"
          paddingTop={1}
        >
          <SessionList
            sessions={sessions}
            selectedId={selectedSessionId}
            focused={focusTarget === "sessionList"}
            onSelect={(id) => {
              selectSession(id);
              setFocusTarget("sessionList");
            }}
          />
        </box>

        {/* Chat Area: Log Pane + Chat Input */}
        <box flexGrow={1} flexDirection="column" backgroundColor="black">
          <LogPane
            session={selectedSession}
            logs={selectedLogs}
            transcripts={selectedTranscripts}
          />
          <SessionChatInput
            session={selectedSession}
            focused={focusTarget === "chatInput"}
            onSubmit={handleSendMessage}
          />
        </box>
      </box>

      <Footer
        mode="list"
        focusTarget={focusTarget}
        canSendMessage={selectedSession?.canSendFollowUp ?? false}
      />
    </box>
  );
}
