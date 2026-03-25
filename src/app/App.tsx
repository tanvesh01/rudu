import { useState, useCallback, useEffect, useRef } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { SessionManager } from "../services/SessionManager.js";
import { useSessionStore } from "../hooks/useSessionStore.js";
import { Header } from "../components/Header.js";
import { SessionList } from "../components/SessionList.js";
import { LogPane } from "../components/LogPane.js";
import { SessionChatInput } from "../components/SessionChatInput.js";
import { Footer } from "../components/Footer.js";
import { WelcomeScreen } from "../components/WelcomeScreen.js";
import { CreateWorktreeDialog } from "../components/CreateWorktreeDialog.js";
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
import type { Worktree } from "../domain/worktree.js";

type AppMode = "list" | "prompt" | "createWorktree";

type FocusTarget = "sessionList" | "chatInput" | "createDialog";

/**
 * Checks if a worktree is in an active state (visible in default navigation).
 */
function isActiveWorktreeStatus(status: Worktree["status"]): boolean {
  return status === "active" || status === "creating";
}

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
  const [mode, setMode] = useState<AppMode>("list");
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const sessionManagerRef = useRef<SessionManager | null>(null);
  const worktreeRepositoryRef = useRef<InstanceType<typeof InMemoryWorktreeRepository> | InstanceType<typeof SyncJsonlWorktreeRepository> | null>(null);
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

    worktreeRepositoryRef.current = worktreeRepository;
    sessionManagerRef.current = new SessionManager({
      repository: sessionRepository,
      worktreeRepository: worktreeRepository,
    });

    // Rehydrate persisted sessions from JSONL
    // Legacy sessions without worktreeId are ignored
    // Orphaned sessions (unknown worktreeId) are marked as recovered
    sessionManagerRef.current.rehydrateFromPersistence();

    // Load worktrees for this repo
    setWorktrees(worktreeRepository.listWorktreesForRepo(repoContext.repoRoot));
  }

  const sessionManager = sessionManagerRef.current;
  const worktreeRepository = worktreeRepositoryRef.current;

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

  // Count active worktrees (those that should be shown in default navigation)
  const activeWorktrees = worktrees.filter((wt) =>
    isActiveWorktreeStatus(wt.status),
  );
  const hasWorktrees = activeWorktrees.length > 0;

  // Create dialog handlers
  const handleOpenCreateDialog = useCallback(() => {
    setMode("createWorktree");
    setFocusTarget("createDialog");
  }, []);

  const handleCloseCreateDialog = useCallback(() => {
    setMode("list");
    setFocusTarget("sessionList");
  }, []);

  const handleSubmitCreateDialog = useCallback(
    (title: string) => {
      // For now, just close the dialog - worktree creation will be implemented
      // by the next feature "orchestrate-git-worktree-creation-and-first-session"
      // This feature only implements the dialog shell
      setMode("list");
      setFocusTarget("sessionList");
    },
    [],
  );

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
    // If in create dialog mode, only handle dialog shortcuts
    if (mode === "createWorktree") {
      if (key.name === "escape") {
        handleCloseCreateDialog();
        return;
      }
      // Let the dialog handle Enter for submission
      return;
    }

    // Ctrl+N - Open create worktree dialog (from any screen)
    if (key.ctrl && key.name === "n") {
      handleOpenCreateDialog();
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

  // Render create dialog overlay
  if (mode === "createWorktree") {
    return (
      <box flexDirection="column" width="100%" height="100%">
        <Header mode="list" />
        <box flexGrow={1}>
          <CreateWorktreeDialog
            repoRoot={repoContext.repoRoot}
            defaultBranch={repoContext.defaultBranch}
            onSubmit={handleSubmitCreateDialog}
            onCancel={handleCloseCreateDialog}
          />
        </box>
        <Footer
          mode="list"
          focusTarget={focusTarget}
          canSendMessage={false}
        />
      </box>
    );
  }

  // Render welcome screen when no worktrees exist
  if (!hasWorktrees) {
    return (
      <box flexDirection="column" width="100%" height="100%">
        <Header mode="list" />
        <box flexGrow={1}>
          <WelcomeScreen onCreateWorktree={handleOpenCreateDialog} />
        </box>
        <Footer
          mode="list"
          focusTarget={focusTarget}
          canSendMessage={false}
        />
      </box>
    );
  }

  // Render populated UI with session list and chat
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
