import { useState, useCallback, useEffect, useRef } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { SessionManager } from "../services/SessionManager.js";
import { useSessionStore } from "../hooks/useSessionStore.js";
import { Header } from "../components/Header.js";
import { LogPane } from "../components/LogPane.js";
import { SessionChatInput } from "../components/SessionChatInput.js";
import { Footer } from "../components/Footer.js";
import { WelcomeScreen } from "../components/WelcomeScreen.js";
import { CreateWorktreeDialog } from "../components/CreateWorktreeDialog.js";
import {
  WorktreeSessionTree,
  getSelectedSession,
} from "../components/WorktreeSessionTree.js";
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
import { createWorktree } from "../services/worktree/GitWorktreeService.js";
import type { TreeNodeType } from "../domain/tree.js";
import {
  buildWorktreeSessionTree,
  repairSelection,
  findFirstNode,
} from "../domain/tree.js";

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
    selectedNodeType,
    selectSession,
    selectTreeNode,
    cancelSession,
    sendSessionMessage,
    hydrateSessionHistory,
    getSessionLogs,
    getSessionTranscripts,
  } = useSessionStore(sessionManager);

  // Derive selected session from tree selection
  // Only sessions can show chat/logs; worktree selection shows no session
  const selectedSession = getSelectedSession(
    worktrees,
    sessions,
    selectedSessionId,
    selectedNodeType,
  );
  const selectedLogs = selectedSession?.id
    ? getSessionLogs(selectedSession.id)
    : [];
  const selectedTranscripts = selectedSession?.id
    ? getSessionTranscripts(selectedSession.id)
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

  const [createError, setCreateError] = useState<string | null>(null);

  const handleSubmitCreateDialog = useCallback(
    (title: string) => {
      if (!worktreeRepository) return;

      setCreateError(null);

      // Create the worktree from the default branch
      const result = createWorktree(
        {
          title,
          repoRoot: repoContext.repoRoot,
          defaultBranch: repoContext.defaultBranch,
        },
        worktreeRepository,
      );

      if (result.type === "failure") {
        setCreateError(result.error);
        // Stay in dialog mode so user can retry or cancel
        return;
      }

      // Refresh worktrees list
      setWorktrees(worktreeRepository.listWorktreesForRepo(repoContext.repoRoot));

      // Create the first session inside the new worktree
      const sessionId = crypto.randomUUID();
      sessionManager.queuePiSession({
        id: sessionId,
        title: `Session for ${result.worktree.title}`,
        prompt: "",
        cwd: result.worktree.path,
        metadata: {
          worktreeId: result.worktree.id,
        },
      });

      // Select the new session (as a session node in the tree)
      selectTreeNode(sessionId, "session");

      // Close dialog and return to list
      setMode("list");
      setFocusTarget("sessionList");
    },
    [repoContext, worktreeRepository, sessionManager, selectTreeNode],
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
    if (!selectedSession?.id) return;
    void hydrateSessionHistory(selectedSession.id).catch(() => {
      // Ignore lazy history hydration failures.
    });
  }, [selectedSession?.id, hydrateSessionHistory]);

  // Repair selection when sessions or worktrees change
  // This ensures the selected node is always valid
  useEffect(() => {
    if (worktrees.length === 0 && sessions.length === 0) {
      // No nodes to select - clear selection
      if (selectedSessionId !== null) {
        selectTreeNode(null, null);
      }
      return;
    }

    const treeNodes = buildWorktreeSessionTree(worktrees, sessions);
    const repaired = repairSelection(treeNodes, {
      selectedId: selectedSessionId,
      selectedType: selectedNodeType,
    });

    if (
      repaired.selectedId !== selectedSessionId ||
      repaired.selectedType !== selectedNodeType
    ) {
      selectTreeNode(repaired.selectedId, repaired.selectedType);
    }
  }, [worktrees, sessions, selectedSessionId, selectedNodeType, selectTreeNode]);

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

    // Ctrl+C - Cancel selected session (only if a session is selected)
    if (key.ctrl && key.name === "c") {
      if (selectedNodeType === "session" && selectedSessionId) {
        handleCancelSession();
      }
      return;
    }

    // Ctrl+L - Focus chat input for selected session (only if session selected)
    if (key.ctrl && key.name === "l") {
      if (selectedNodeType === "session" && selectedSession?.canSendFollowUp) {
        setFocusTarget("chatInput");
      }
      return;
    }

    // Enter - Focus chat input from session list (only if session selected and can chat)
    if (
      key.name === "enter" &&
      focusTarget === "sessionList" &&
      selectedNodeType === "session" &&
      selectedSession?.canSendFollowUp
    ) {
      setFocusTarget("chatInput");
      return;
    }

    // Tab - Toggle focus between session list and chat input (only if session selected)
    if (key.name === "tab") {
      if (selectedNodeType === "session" && selectedSession?.canSendFollowUp) {
        setFocusTarget((prev) =>
          prev === "sessionList" ? "chatInput" : "sessionList",
        );
      }
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
            error={createError}
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

  // Render populated UI with combined worktree/session tree and chat
  return (
    <box flexDirection="column" width="100%" height="100%">
      <Header mode="list" />

      <box flexGrow={1} flexDirection="row">
        {/* Combined Worktree/Session Tree */}
        <box
          width={50}
          height="100%"
          backgroundColor="#1a1a1a"
          flexDirection="column"
          paddingTop={1}
        >
          <WorktreeSessionTree
            worktrees={worktrees}
            sessions={sessions}
            selectedId={selectedSessionId}
            selectedType={selectedNodeType}
            focused={focusTarget === "sessionList"}
            onSelect={(id, type) => {
              selectTreeNode(id, type);
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
        selectedNodeType={selectedNodeType}
      />
    </box>
  );
}
