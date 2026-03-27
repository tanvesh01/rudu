import { useState, useCallback, useEffect, useRef } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { SessionManager } from "../services/SessionManager.js";
import type { QueuePiSessionInput } from "../services/SessionManager.js";
import { useSessionStore } from "../hooks/useSessionStore.js";
import { Header } from "../components/Header.js";
import { LogPane } from "../components/LogPane.js";
import { SessionChatInput } from "../components/SessionChatInput.js";
import { Footer } from "../components/Footer.js";
import { WelcomeScreen } from "../components/WelcomeScreen.js";
import { CreateWorktreeDialog } from "../components/CreateWorktreeDialog.js";
import {
  WorktreeList,
  getSessionForWorktree,
  repairWorktreeSelection,
} from "../components/WorktreeList.js";
import { InMemorySessionRepository } from "../services/persistence/JsonlSessionRepository.js";
import { SyncJsonlSessionRepository } from "../services/persistence/SyncJsonlSessionRepository.js";
import { InMemoryWorktreeRepository } from "../services/persistence/SyncJsonlWorktreeRepository.js";
import { SyncJsonlWorktreeRepository } from "../services/persistence/SyncJsonlWorktreeRepository.js";
import {
  detectRepoContext,
  isSupportedRepo,
  type RepoContextResult,
} from "../services/repo/RepoContext.js";
import {
  detectStartupPreflight,
  type StartupPreflightResult,
} from "../services/runtime/StartupPreflight.js";
import type { Worktree } from "../domain/worktree.js";
import {
  createWorktreeAsync,
  archiveWorktree,
  deleteWorktree,
} from "../services/worktree/GitWorktreeService.js";
import { reconcileWorktreesOnRestart } from "../services/worktree/RestartReconciliation.js";

type AppMode = "list" | "prompt" | "createWorktree";

type FocusTarget = "sessionList" | "chatInput" | "createDialog";
type SessionRepositoryInstance =
  | InstanceType<typeof InMemorySessionRepository>
  | InstanceType<typeof SyncJsonlSessionRepository>;
type WorktreeRepositoryInstance =
  | InstanceType<typeof InMemoryWorktreeRepository>
  | InstanceType<typeof SyncJsonlWorktreeRepository>;

interface AppTestOverrides {
  startupPreflight?: StartupPreflightResult;
  repoContext?: RepoContextResult;
  sessionRepository?: SessionRepositoryInstance;
  worktreeRepository?: WorktreeRepositoryInstance;
  skipReconciliation?: boolean;
  createWorktreeAsync?: typeof createWorktreeAsync;
}

interface AppProps {
  testOverrides?: AppTestOverrides;
}

/**
 * Checks if a worktree is in an active state (visible in default navigation).
 */
function isActiveWorktreeStatus(status: Worktree["status"]): boolean {
  return status === "active" || status === "creating";
}

/**
 * Blocked startup state UI shown when required environment checks fail.
 */
function BlockedStartupState({
  title,
  reason,
  suggestion,
}: {
  title: string;
  reason: string;
  suggestion?: string;
}) {
  return (
    <box flexDirection="column" width="100%" height="100%">
      <box
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        flexGrow={1}
      >
        <text content={title} fg="red" />
        <text content={reason} fg="gray" marginTop={1} />
        {suggestion ? (
          <text content={suggestion} fg="gray" marginTop={1} />
        ) : null}
      </box>
    </box>
  );
}

export function buildWorktreePiSessionInput(
  worktree: Pick<Worktree, "id" | "title" | "path" | "repoRoot">,
  id: string,
): QueuePiSessionInput {
  return {
    id,
    title: `Session for ${worktree.title}`,
    prompt: "",
    cwd: worktree.path,
    repoRoot: worktree.repoRoot,
    worktreePath: worktree.path,
    metadata: {
      worktreeId: worktree.id,
    },
  };
}

export function App({ testOverrides }: AppProps = {}) {
  const renderer = useRenderer();

  // Show debug console on startup for debugging
  // useEffect(() => {
  //   renderer.console.show();
  // }, [renderer]);

  const [focusTarget, setFocusTarget] = useState<FocusTarget>("sessionList");
  const [mode, setMode] = useState<AppMode>("list");
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const sessionManagerRef = useRef<SessionManager | null>(null);
  const startupPreflightRef = useRef<StartupPreflightResult | null>(null);
  const worktreeRepositoryRef = useRef<
    | InstanceType<typeof InMemoryWorktreeRepository>
    | InstanceType<typeof SyncJsonlWorktreeRepository>
    | null
  >(null);
  const repoContextRef = useRef<RepoContextResult | null>(null);

  if (!startupPreflightRef.current) {
    if (testOverrides?.startupPreflight) {
      startupPreflightRef.current = testOverrides.startupPreflight;
    } else {
      const isTestEnvironment =
        process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test";

      startupPreflightRef.current = isTestEnvironment
        ? { type: "ready" }
        : detectStartupPreflight();
    }
  }

  const startupPreflight = startupPreflightRef.current;

  if (startupPreflight.type === "blocked") {
    return (
      <BlockedStartupState
        title={startupPreflight.title}
        reason={startupPreflight.reason}
        suggestion={startupPreflight.suggestion}
      />
    );
  }

  // Initialize repo context once at startup
  if (!repoContextRef.current) {
    if (testOverrides?.repoContext) {
      repoContextRef.current = testOverrides.repoContext;
    } else {
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
  }

  const repoContext = repoContextRef.current;

  // Show unsupported state if not in a git repository
  if (!isSupportedRepo(repoContext)) {
    return (
      <BlockedStartupState
        title="Unsupported Directory"
        reason={repoContext.reason}
        suggestion="Rudu must be launched from within a git repository."
      />
    );
  }

  // Initialize SessionManager once with JSONL persistence
  if (!sessionManagerRef.current) {
    const isTestEnvironment =
      process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test";

    const sessionRepository =
      testOverrides?.sessionRepository ??
      (isTestEnvironment
        ? new InMemorySessionRepository()
        : new SyncJsonlSessionRepository({
            projectRoot: repoContext.repoRoot,
          }));

    const worktreeRepository =
      testOverrides?.worktreeRepository ??
      (isTestEnvironment
        ? new InMemoryWorktreeRepository()
        : new SyncJsonlWorktreeRepository({
            projectRoot: repoContext.repoRoot,
          }));

    worktreeRepositoryRef.current = worktreeRepository;
    sessionManagerRef.current = new SessionManager({
      repository: sessionRepository,
      worktreeRepository: worktreeRepository,
    });

    // Restart reconciliation:
    // 1. Compare persisted worktrees with actual git worktree state
    // 2. Mark missing/out-of-sync worktrees as degraded recovered state
    // 3. Do NOT silently recreate missing worktrees
    const reconciliationResult = testOverrides?.skipReconciliation
      ? {
          validWorktrees: worktreeRepository.listWorktreesForRepo(
            repoContext.repoRoot,
          ),
          missingWorktrees: [],
          recoveredWorktreeIds: [],
        }
      : reconcileWorktreesOnRestart(repoContext.repoRoot, worktreeRepository);

    // Rehydrate persisted sessions from JSONL
    // Legacy sessions without worktreeId are ignored
    // Orphaned sessions (unknown worktreeId) are marked as recovered
    // Interrupted sessions (queued/starting/running/cancelling) are converted to failed/recovered
    sessionManagerRef.current.rehydrateFromPersistence();

    // Load worktrees for this repo - only valid worktrees after reconciliation
    // Missing worktrees are surfaced as degraded recovered state without recreation
    setWorktrees(reconciliationResult.validWorktrees);
  }

  const sessionManager = sessionManagerRef.current;
  const worktreeRepository = worktreeRepositoryRef.current;

  const {
    sessions,
    selectedWorktreeId,
    selectWorktree,
    cancelSession,
    sendSessionMessage,
    hydrateSessionHistory,
    getSessionLogs,
    getSessionTranscripts,
  } = useSessionStore(sessionManager);

  useEffect(() => {
    if (!worktreeRepository) return;

    for (const worktree of worktrees) {
      if (!isActiveWorktreeStatus(worktree.status)) continue;
      sessionManager.ensureWorktreeSession({
        worktreeId: worktree.id,
        title: worktree.title,
        cwd: worktree.path,
        repoRoot: worktree.repoRoot,
      });
    }
  }, [worktrees, sessionManager, worktreeRepository]);

  // Derive selected session from worktree selection
  // In single-session mode, each worktree has exactly one associated session
  const selectedSession = getSessionForWorktree(
    worktrees,
    sessions,
    selectedWorktreeId,
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
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreatingWorktree, setIsCreatingWorktree] = useState(false);

  // Create dialog handlers
  const handleOpenCreateDialog = useCallback(() => {
    setCreateError(null);
    setMode("createWorktree");
    setFocusTarget("createDialog");
  }, []);

  const handleCloseCreateDialog = useCallback(() => {
    setCreateError(null);
    setMode("list");
    setFocusTarget("sessionList");
  }, []);

  const handleSubmitCreateDialog = useCallback(
    async (title: string) => {
      if (!worktreeRepository) return;

      if (isCreatingWorktree) {
        return;
      }

      setCreateError(null);
      setIsCreatingWorktree(true);

      const createWorktreeImpl =
        testOverrides?.createWorktreeAsync ?? createWorktreeAsync;

      try {
        // Create the worktree from the default branch
        const result = await createWorktreeImpl(
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
        setWorktrees(
          worktreeRepository.listWorktreesForRepo(repoContext.repoRoot),
        );

        // Create the first session inside the new worktree
        sessionManager.queuePiSession(
          buildWorktreePiSessionInput(result.worktree, crypto.randomUUID()),
        );

        // Select the new worktree (flat mode - session is implicit)
        selectWorktree(result.worktree.id);

        // Close dialog and return to list
        setMode("list");
        setFocusTarget("sessionList");
      } finally {
        setIsCreatingWorktree(false);
      }
    },
    [
      repoContext,
      worktreeRepository,
      sessionManager,
      selectWorktree,
      testOverrides,
      isCreatingWorktree,
    ],
  );

  // Cancel selected session
  const handleCancelSession = useCallback(() => {
    if (selectedSession?.id) {
      cancelSession(selectedSession.id);
    }
  }, [selectedSession, cancelSession]);

  // Archive selected worktree
  const handleArchiveWorktree = useCallback(() => {
    if (selectedWorktreeId && worktreeRepository) {
      const result = archiveWorktree(
        selectedWorktreeId,
        worktreeRepository,
        repoContext.repoRoot,
        sessionManager,
      );
      if (result.type === "success") {
        // Refresh worktrees list
        setWorktrees(
          worktreeRepository.listWorktreesForRepo(repoContext.repoRoot),
        );
      } else if (result.type === "blocked") {
        // Sessions are being cancelled - the UI will reflect this
        // Selection will be repaired by the useEffect when worktrees/sessions change
        // Refresh worktrees to show cleanup_pending status
        setWorktrees(
          worktreeRepository.listWorktreesForRepo(repoContext.repoRoot),
        );
      }
      // On failure, the error is silently ignored for now (could show toast in future)
    }
  }, [
    selectedWorktreeId,
    worktreeRepository,
    repoContext.repoRoot,
    sessionManager,
  ]);

  // Delete selected worktree
  const handleDeleteWorktree = useCallback(() => {
    if (selectedWorktreeId && worktreeRepository) {
      const result = deleteWorktree(
        selectedWorktreeId,
        worktreeRepository,
        sessionManager,
      );

      if (result.type === "success") {
        // Refresh worktrees list
        setWorktrees(
          worktreeRepository.listWorktreesForRepo(repoContext.repoRoot),
        );
      } else if (result.type === "blocked") {
        // Sessions are being cancelled - the UI will reflect this
        // Selection will be repaired by the useEffect when worktrees/sessions change
        // Refresh worktrees to show cleanup_pending status
        setWorktrees(
          worktreeRepository.listWorktreesForRepo(repoContext.repoRoot),
        );
      }
      // On failure, the error is silently ignored for now (could show toast in future)
    }
  }, [
    selectedWorktreeId,
    worktreeRepository,
    repoContext.repoRoot,
    sessionManager,
  ]);

  // Send message to selected session
  const handleSendMessage = useCallback(
    async (text: string) => {
      if (selectedSession?.id && selectedSession?.canSendFollowUp) {
        await sendSessionMessage(selectedSession.id, text);
      }
    },
    [selectedSession, sendSessionMessage],
  );

  useEffect(() => {
    if (!selectedSession?.id) return;
    void hydrateSessionHistory(selectedSession.id).catch(() => {
      // Ignore lazy history hydration failures.
    });
  }, [selectedSession?.id, hydrateSessionHistory]);

  // Repair selection when worktrees change
  // This ensures the selected worktree is always valid
  useEffect(() => {
    if (worktrees.length === 0) {
      // No worktrees to select - clear selection
      if (selectedWorktreeId !== null) {
        selectWorktree(null);
      }
      return;
    }

    const repairedId = repairWorktreeSelection(worktrees, selectedWorktreeId);

    if (repairedId !== selectedWorktreeId) {
      selectWorktree(repairedId);
    }
  }, [worktrees, selectedWorktreeId, selectWorktree]);

  // Keyboard shortcuts
  useKeyboard((key) => {
    // If in create dialog mode, only handle dialog shortcuts
    if (mode === "createWorktree") {
      if (isCreatingWorktree) {
        return;
      }
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

    // Ctrl+C - Cancel selected session (only if a session exists for the selected worktree)
    if (key.ctrl && key.name === "c") {
      if (selectedSession?.id) {
        handleCancelSession();
      }
      return;
    }

    // Ctrl+A - Archive selected worktree
    if (key.ctrl && key.name === "a") {
      if (selectedWorktreeId) {
        handleArchiveWorktree();
      }
      return;
    }

    // Ctrl+D - Delete selected worktree
    if (key.ctrl && key.name === "d") {
      if (selectedWorktreeId) {
        handleDeleteWorktree();
      }
      return;
    }

    // Ctrl+L - Focus chat input for selected session (only if session exists and can chat)
    if (key.ctrl && key.name === "l") {
      if (selectedSession?.canSendFollowUp) {
        setFocusTarget("chatInput");
      }
      return;
    }

    // Tab - Toggle focus between session list and chat input (only if session exists and can chat)
    if (key.name === "tab") {
      if (selectedSession?.canSendFollowUp) {
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
      <box
        flexDirection="column"
        width="100%"
        height="100%"
        border
        borderColor="#666666"
      >
        <Header mode="list" />
        <box flexGrow={1}>
          <CreateWorktreeDialog
            repoRoot={repoContext.repoRoot}
            defaultBranch={repoContext.defaultBranch}
            onSubmit={handleSubmitCreateDialog}
            onCancel={handleCloseCreateDialog}
            error={createError}
            isCreating={isCreatingWorktree}
          />
        </box>
        <Footer mode="list" focusTarget={focusTarget} canSendMessage={false} />
      </box>
    );
  }

  // Render welcome screen when no worktrees exist
  if (!hasWorktrees) {
    return (
      <box
        flexDirection="column"
        width="100%"
        height="100%"
        border
        borderColor="#666666"
      >
        <Header mode="list" />
        <box flexGrow={1}>
          <WelcomeScreen onCreateWorktree={handleOpenCreateDialog} />
        </box>
        <Footer mode="list" focusTarget={focusTarget} canSendMessage={false} />
      </box>
    );
  }

  // Render populated UI with combined worktree/session tree and chat
  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      border
      borderColor="#666666"
    >
      <Header mode="list" />

      <box flexGrow={1} flexDirection="row">
        {/* Flat Worktree List (single-session mode) */}
        <box
          width={25}
          height="100%"
          backgroundColor="#1a1a1a"
          flexDirection="column"
          paddingTop={1}
        >
          <WorktreeList
            worktrees={worktrees}
            sessions={sessions}
            selectedWorktreeId={selectedWorktreeId}
            focused={focusTarget === "sessionList"}
            onSelect={(worktreeId) => {
              selectWorktree(worktreeId);
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
        hasSelectedSession={!!selectedSession}
      />
    </box>
  );
}
