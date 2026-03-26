import type { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { TranscriptMessage } from "../../domain/transcript.js";
import type { SessionLogRingBuffer } from "./log-buffer.js";
import type { TranscriptRingBuffer } from "./transcript-buffer.js";
import type { SessionRepository } from "../persistence/SessionRepository.js";

export type SessionId = string;

export type SessionStatus =
  | "queued"
  | "starting"
  | "running"
  | "cancelling"
  | "cancelled"
  | "succeeded"
  | "failed";

export type SessionLogStream = "stdout" | "stderr" | "system";
export type SessionCancelReason = "user" | "shutdown";

export interface QueueSessionInput {
  id?: SessionId;
  title: string;
  command: readonly [string, ...string[]];
  cwd?: string;
  env?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface QueuePiSessionInput {
  id?: SessionId;
  title: string;
  prompt: string;
  cwd?: string;
  metadata?: Record<string, unknown>;
  model?: string;
}

export interface SessionLogLine {
  timestamp: number;
  stream: SessionLogStream;
  text: string;
}

export interface SessionLogSummary {
  retainedLines: number;
  retainedBytes: number;
  droppedLines: number;
}

export interface TranscriptSummary {
  retainedMessages: number;
  retainedBytes: number;
  droppedMessages: number;
}

export type SessionRuntimeType = "subprocess" | "pi-sdk";

export interface SessionSnapshot {
  id: SessionId;
  title: string;
  command: readonly string[];
  cwd?: string;
  metadata?: Record<string, unknown>;
  status: SessionStatus;
  pid?: number;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  cancelRequestedAt?: number;
  exitCode?: number | null;
  signalCode?: string | null;
  error?: string;
  logSummary: SessionLogSummary;
  transcriptSummary: TranscriptSummary;
  runtimeType?: SessionRuntimeType;
  canResume?: boolean;
  piSessionFile?: string;
  canSendFollowUp: boolean;
  /**
   * Durable worktree ID linking this session to its worktree.
   * This enables reconstruction of session-to-worktree relationships
   * by durable ID rather than inferred path matching.
   */
  worktreeId?: string;
}

export interface SessionManagerEventMap {
  sessionQueued: { session: SessionSnapshot };
  sessionStarting: { session: SessionSnapshot };
  sessionStarted: { session: SessionSnapshot; pid: number };
  sessionLogBatch: {
    sessionId: SessionId;
    session: SessionSnapshot;
    lines: readonly SessionLogLine[];
    logSummary: SessionLogSummary;
  };
  sessionTranscriptUpdate: {
    sessionId: SessionId;
    session: SessionSnapshot;
    message: TranscriptMessage;
  };
  sessionCancelRequested: {
    session: SessionSnapshot;
    reason: SessionCancelReason;
  };
  sessionCancelled: {
    session: SessionSnapshot;
    exitCode: number | null;
    signalCode: string | null;
  };
  sessionSucceeded: { session: SessionSnapshot; exitCode: number };
  sessionFailed: {
    session: SessionSnapshot;
    exitCode: number | null;
    signalCode: string | null;
    error?: string;
  };
  sessionError: {
    sessionId: SessionId;
    session: SessionSnapshot;
    error: string;
    recoverable: boolean;
  };
}

export interface SessionManagerOptions {
  maxConcurrent?: number;
  eventThrottleMs?: number;
  logBufferMaxLines?: number;
  logBufferMaxBytes?: number;
  transcriptBufferMaxLines?: number;
  transcriptBufferMaxBytes?: number;
  cancelKillGraceMs?: number;
  autoInstallShutdownHooks?: boolean;
  now?: () => number;
  generateId?: () => string;
  /**
   * Repository for session persistence.
   */
  repository?: SessionRepository;
  /**
   * Repository for worktree persistence.
   * Required for worktree-first session filtering during rehydration.
   */
  worktreeRepository?: import("../persistence/WorktreeRepository.js").WorktreeRepository;
  piAuthStorage?: AuthStorage;
  piModelRegistry?: ModelRegistry;
}

export type SessionListener<K extends keyof SessionManagerEventMap> = (
  payload: SessionManagerEventMap[K],
) => void;
export type NonLogEventName = Exclude<
  keyof SessionManagerEventMap,
  "sessionLogBatch"
>;

export type PendingEvent =
  | {
      kind: "event";
      type: NonLogEventName;
      payload: SessionManagerEventMap[NonLogEventName];
    }
  | { kind: "log"; sessionId: SessionId };

export interface PiSessionRuntime {
  agentSession: import("@mariozechner/pi-coding-agent").AgentSession;
  abortController: AbortController;
  unsubscribe: () => void;
}

export interface SessionRecord {
  id: SessionId;
  title: string;
  command: string[];
  cwd?: string;
  env?: Record<string, string>;
  metadata?: Record<string, unknown>;
  status: SessionStatus;
  pid?: number;
  runtimeType?: SessionRuntimeType;
  piRuntime?: PiSessionRuntime;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  cancelRequestedAt?: number;
  exitCode?: number | null;
  signalCode?: string | null;
  error?: string;
  logBuffer: SessionLogRingBuffer;
  transcriptBuffer: TranscriptRingBuffer;
  completion: Promise<SessionSnapshot>;
  resolveCompletion: (snapshot: SessionSnapshot) => void;
  completed: boolean;

  // Worktree linkage - durable association by ID
  // This replaces path-only association with stable worktree identity
  worktreeId?: string;

  // Persistence-related fields
  originalCwd?: string;
  effectiveCwd?: string;
  repoRoot?: string;
  worktreePath?: string;
  worktreeStatus?:
    | "none"
    | "creating"
    | "ready"
    | "cleanup_pending"
    | "cleanup_failed"
    | "removed"
    | "preserved";
  cleanupPolicy?: "always" | "on_success" | "preserve_on_failure" | "never";
  cleanupStatus?: "none" | "pending" | "succeeded" | "failed" | "skipped";
  piSessionId?: string;
  piSessionFile?: string;
  canResume?: boolean;
  recovered?: boolean;
}

export interface SessionRuntime {
  subprocess: Bun.Subprocess<"ignore", "pipe", "pipe">;
  abortController: AbortController;
  stdoutTask: Promise<void>;
  stderrTask: Promise<void>;
  killEscalationTimer: ReturnType<typeof setTimeout> | null;
  cancelRequested: boolean;
  cancelReason?: SessionCancelReason;
}
