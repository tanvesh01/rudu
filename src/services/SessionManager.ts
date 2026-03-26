// src/services/SessionManager.ts

import { existsSync } from "fs";
import type { TranscriptMessage } from "../domain/transcript.js";
import { SessionEventBus } from "./session-manager/event-bus.js";
import { SessionLogRingBuffer } from "./session-manager/log-buffer.js";
import { PiSessionRunner } from "./session-manager/pi-runner.js";
import { ProcessSessionRunner } from "./session-manager/process-runner.js";
import { TranscriptRingBuffer } from "./session-manager/transcript-buffer.js";
import type {
  NonLogEventName,
  PiSessionRuntime,
  QueuePiSessionInput,
  QueueSessionInput,
  SessionCancelReason,
  SessionId,
  SessionListener,
  SessionLogLine,
  SessionManagerEventMap,
  SessionManagerOptions,
  SessionRecord,
  SessionRuntime,
  SessionRuntimeType,
  SessionSnapshot,
  SessionStatus,
} from "./session-manager/types.js";
import type { SessionRepository } from "./persistence/SessionRepository.js";
import { NoopSessionRepository } from "./persistence/SessionRepository.js";
import type { WorktreeRepository } from "./persistence/WorktreeRepository.js";
import { NoopWorktreeRepository } from "./persistence/WorktreeRepository.js";
export type {
  QueuePiSessionInput,
  QueueSessionInput,
  SessionCancelReason,
  SessionId,
  SessionLogLine,
  SessionLogStream,
  SessionLogSummary,
  SessionManagerEventMap,
  SessionManagerOptions,
  SessionRuntimeType,
  SessionSnapshot,
  SessionStatus,
  TranscriptSummary,
} from "./session-manager/types.js";
export type { TranscriptMessage };

const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_EVENT_THROTTLE_MS = 100;
const DEFAULT_LOG_BUFFER_MAX_LINES = 2000;
const DEFAULT_LOG_BUFFER_MAX_BYTES = 1000000;
const DEFAULT_CANCEL_KILL_GRACE_MS = 2500;

function isTerminalStatus(status: SessionStatus): boolean {
  return (
    status === "cancelled" || status === "succeeded" || status === "failed"
  );
}

function cloneMetadata(
  metadata?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return metadata ? { ...metadata } : undefined;
}

function normalizeEnv(
  env?: Record<string, string>,
): Record<string, string> | undefined {
  if (!env || Object.keys(env).length === 0) return undefined;
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") merged[key] = value;
  }
  for (const [key, value] of Object.entries(env)) {
    merged[key] = value;
  }
  return merged;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SessionManager {
  private maxConcurrent: number;
  private eventThrottleMs: number;
  private cancelKillGraceMs: number;
  private now: () => number;
  private generateId: () => string;
  private sessions = new Map<SessionId, SessionRecord>();
  private sessionOrder: SessionId[] = [];
  private queue: SessionId[] = [];
  private activeSessions = new Set<SessionId>();
  private runtimes = new Map<SessionId, SessionRuntime>();
  private piRuntimes = new Map<SessionId, PiSessionRuntime>();
  private eventBus: SessionEventBus;
  private piRunner: PiSessionRunner;
  private processRunner: ProcessSessionRunner;
  private shuttingDown = false;
  private disposed = false;
  private createLogBuffer: () => SessionLogRingBuffer;
  private repository: SessionRepository;
  private worktreeRepository: WorktreeRepository;

  private handleBeforeExit = () => {
    void this.shutdown();
  };
  private handleExit = () => {
    this.forceTerminateAll("SIGTERM");
  };

  constructor(options: SessionManagerOptions = {}) {
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.eventThrottleMs = options.eventThrottleMs ?? DEFAULT_EVENT_THROTTLE_MS;
    this.cancelKillGraceMs =
      options.cancelKillGraceMs ?? DEFAULT_CANCEL_KILL_GRACE_MS;
    this.now = options.now ?? (() => Date.now());
    this.generateId = options.generateId ?? (() => crypto.randomUUID());
    this.repository = options.repository ?? new NoopSessionRepository();
    this.worktreeRepository =
      options.worktreeRepository ?? new NoopWorktreeRepository();
    const logBufferMaxLines =
      options.logBufferMaxLines ?? DEFAULT_LOG_BUFFER_MAX_LINES;
    const logBufferMaxBytes =
      options.logBufferMaxBytes ?? DEFAULT_LOG_BUFFER_MAX_BYTES;
    this.createLogBuffer = () =>
      new SessionLogRingBuffer(logBufferMaxLines, logBufferMaxBytes);
    this.eventBus = new SessionEventBus({
      eventThrottleMs: this.eventThrottleMs,
      getLogPayload: (sessionId) => {
        const record = this.sessions.get(sessionId);
        if (!record) return undefined;
        return {
          session: this.toSnapshot(record),
          logSummary: record.logBuffer.getSummary(),
        };
      },
    });
    this.processRunner = new ProcessSessionRunner({
      now: this.now,
      onLogLines: (sessionId, lines) => {
        this.appendLogLines(sessionId, lines);
      },
      onExit: (sessionId, result) => {
        const record = this.sessions.get(sessionId);
        if (!record) return;
        const runtime = this.runtimes.get(sessionId);
        if (runtime?.killEscalationTimer) {
          clearTimeout(runtime.killEscalationTimer);
          runtime.killEscalationTimer = null;
        }
        this.runtimes.delete(sessionId);
        if (result.cancelled || record.status === "cancelling") {
          this.finalizeSession(record, {
            status: "cancelled",
            exitCode: result.exitCode,
            signalCode: result.signalCode,
          });
          return;
        }
        if ((result.exitCode ?? 1) === 0) {
          this.finalizeSession(record, {
            status: "succeeded",
            exitCode: result.exitCode ?? 0,
            signalCode: result.signalCode,
          });
          return;
        }
        this.finalizeSession(record, {
          status: "failed",
          exitCode: result.exitCode,
          signalCode: result.signalCode,
          error: record.error,
        });
      },
    });
    this.piRunner = new PiSessionRunner({
      now: this.now,
      generateId: this.generateId,
      authStorage: options.piAuthStorage,
      modelRegistry: options.piModelRegistry,
      onBusyStateChange: (sessionId, isBusy) => {
        if (isBusy) {
          this.activeSessions.add(sessionId);
          return;
        }
        this.activeSessions.delete(sessionId);
        this.pumpQueue();
      },
      onTranscriptAppend: (sessionId, message) => {
        this.appendTranscriptMessage(sessionId, message);
      },
      onTranscriptUpdate: (sessionId, message) => {
        if (message.role !== "tool") {
          this.updateTranscriptMessage(sessionId, message);
          return;
        }

        const record = this.sessions.get(sessionId);
        if (!record) return;
        const existing = record.transcriptBuffer
          .snapshot()
          .find((entry) => entry.id === message.id);
        if (!existing) {
          this.appendTranscriptMessage(sessionId, message);
          return;
        }

        this.updateTranscriptMessage(sessionId, {
          ...message,
          text: `${existing.text}, ${message.text}`,
        });
      },
      onFatalError: (sessionId, error) => {
        const record = this.sessions.get(sessionId);
        if (!record) return;
        this.finalizeSession(record, {
          status: "failed",
          exitCode: null,
          signalCode: null,
          error,
        });
      },
    });
    if (options.autoInstallShutdownHooks ?? true) {
      process.once("beforeExit", this.handleBeforeExit);
      process.once("exit", this.handleExit);
    }
  }

  on<K extends keyof SessionManagerEventMap>(
    event: K,
    listener: SessionListener<K>,
  ): () => void {
    return this.eventBus.on(event, listener);
  }

  off<K extends keyof SessionManagerEventMap>(
    event: K,
    listener: SessionListener<K>,
  ): void {
    this.eventBus.off(event, listener);
  }

  queueSession(input: QueueSessionInput): SessionSnapshot {
    this.assertUsable();
    const id = input.id ?? this.generateId();
    if (this.sessions.has(id))
      throw new Error(`Session with id "${id}" already exists.`);
    const queuedAt = this.now();
    let resolveCompletion!: (snapshot: SessionSnapshot) => void;
    const completion = new Promise<SessionSnapshot>((resolve) => {
      resolveCompletion = resolve;
    });
    const record: SessionRecord = {
      id,
      title: input.title,
      command: [...input.command],
      cwd: input.cwd,
      env: normalizeEnv(input.env),
      metadata: cloneMetadata(input.metadata),
      status: "queued",
      queuedAt,
      logBuffer: this.createLogBuffer(),
      transcriptBuffer: new TranscriptRingBuffer(),
      completion,
      resolveCompletion,
      completed: false,
      originalCwd: input.cwd,
      effectiveCwd: input.cwd,
      worktreeId: input.metadata?.worktreeId as string | undefined,
      worktreeStatus: "none",
      cleanupPolicy: "preserve_on_failure",
      cleanupStatus: "none",
      canResume: false,
      recovered: false,
    };
    this.sessions.set(id, record);
    this.sessionOrder.push(id);
    this.queue.push(id);

    // Persist the new session
    try {
      this.repository.insertSession({
        id: record.id,
        title: record.title,
        prompt: record.metadata?.prompt as string | undefined,
        runtimeType: record.runtimeType!,
        status: record.status,
        originalCwd: record.originalCwd,
        effectiveCwd: record.effectiveCwd,
        repoRoot: record.repoRoot,
        worktreePath: record.worktreePath,
        worktreeId: record.worktreeId,
        worktreeStatus: record.worktreeStatus!,
        cleanupPolicy: record.cleanupPolicy!,
        cleanupStatus: record.cleanupStatus!,
        piSessionId: record.piSessionId,
        piSessionFile: record.piSessionFile,
        canResume: record.canResume!,
        recovered: record.recovered!,
        lastError: record.error,
        queuedAt: record.queuedAt,
        startedAt: record.startedAt,
        finishedAt: record.finishedAt,
        cancelRequestedAt: record.cancelRequestedAt,
      });
    } catch (error) {
      console.error(
        `[SessionManager] Failed to persist session ${record.id}:`,
        error,
      );
    }

    this.enqueueEvent("sessionQueued", { session: this.toSnapshot(record) });
    this.pumpQueue();
    return this.toSnapshot(record);
  }

  queuePiSession(input: QueuePiSessionInput): SessionSnapshot {
    this.assertUsable();
    const id = input.id ?? this.generateId();
    if (this.sessions.has(id))
      throw new Error(`Session with id "${id}" already exists.`);
    const queuedAt = this.now();
    const initialPrompt = input.prompt.trim();
    let resolveCompletion!: (snapshot: SessionSnapshot) => void;
    const completion = new Promise<SessionSnapshot>((resolve) => {
      resolveCompletion = resolve;
    });

    const transcriptBuffer = new TranscriptRingBuffer();
    let initialTranscript: TranscriptMessage | null = null;
    if (initialPrompt.length > 0) {
      initialTranscript = {
        id: this.generateId(),
        role: "user",
        text: initialPrompt,
        timestamp: queuedAt,
      };
      transcriptBuffer.append(initialTranscript);
    }

    const metadata: Record<string, unknown> = {
      ...cloneMetadata(input.metadata),
      isPiSession: true,
    };
    if (initialPrompt.length > 0) {
      metadata.prompt = initialPrompt;
    }

    const record: SessionRecord = {
      id,
      title: input.title,
      command: ["pi-sdk-session"],
      cwd: input.cwd,
      env: undefined,
      metadata,
      status: "queued",
      queuedAt,
      logBuffer: this.createLogBuffer(),
      transcriptBuffer,
      runtimeType: "pi-sdk",
      completion,
      resolveCompletion,
      completed: false,
      originalCwd: input.cwd,
      effectiveCwd: input.cwd,
      worktreeId: input.metadata?.worktreeId as string | undefined,
      worktreeStatus: "none",
      cleanupPolicy: "preserve_on_failure",
      cleanupStatus: "none",
      canResume: false,
      recovered: false,
    };
    this.sessions.set(id, record);
    this.sessionOrder.push(id);
    this.queue.push(id);

    // Persist the new session
    try {
      this.repository.insertSession({
        id: record.id,
        title: record.title,
        prompt: record.metadata?.prompt as string | undefined,
        runtimeType: record.runtimeType!,
        status: record.status,
        originalCwd: record.originalCwd,
        effectiveCwd: record.effectiveCwd,
        repoRoot: record.repoRoot,
        worktreePath: record.worktreePath,
        worktreeId: record.worktreeId,
        worktreeStatus: record.worktreeStatus!,
        cleanupPolicy: record.cleanupPolicy!,
        cleanupStatus: record.cleanupStatus!,
        piSessionId: record.piSessionId,
        piSessionFile: record.piSessionFile,
        canResume: record.canResume!,
        recovered: record.recovered!,
        lastError: record.error,
        queuedAt: record.queuedAt,
        startedAt: record.startedAt,
        finishedAt: record.finishedAt,
        cancelRequestedAt: record.cancelRequestedAt,
      });
    } catch (error) {
      console.error(
        `[SessionManager] Failed to persist session ${record.id}:`,
        error,
      );
    }

    this.enqueueEvent("sessionQueued", { session: this.toSnapshot(record) });
    if (initialTranscript) {
      this.enqueueEvent("sessionTranscriptUpdate", {
        sessionId: id,
        session: this.toSnapshot(record),
        message: initialTranscript,
      });
    }
    this.pumpQueue();
    return this.toSnapshot(record);
  }

  /**
   * Ensures a worktree has at least one attached session.
   *
   * If a session already exists for the worktree, returns the most recent one.
   * Otherwise, creates a default PI session linked to that worktree.
   */
  ensureWorktreeSession(input: {
    worktreeId: string;
    title: string;
    cwd: string;
    repoRoot: string;
  }): SessionSnapshot {
    this.assertUsable();

    const existing = this.sessionOrder
      .map((id) => this.sessions.get(id))
      .filter((record): record is SessionRecord => record != null)
      .filter((record) => record.worktreeId === input.worktreeId)
      .sort((a, b) => b.queuedAt - a.queuedAt)[0];

    if (existing) {
      return this.toSnapshot(existing);
    }

    return this.queuePiSession({
      title: `Session for ${input.title}`,
      prompt: "",
      cwd: input.cwd,
      repoRoot: input.repoRoot,
      worktreePath: input.cwd,
      metadata: {
        worktreeId: input.worktreeId,
      },
    });
  }

  cancelSession(
    sessionId: SessionId,
    reason: SessionCancelReason = "user",
  ): boolean {
    const record = this.sessions.get(sessionId);
    if (!record || isTerminalStatus(record.status)) return false;
    if (record.status === "cancelling") return true;
    record.cancelRequestedAt = this.now();
    record.status = "cancelling";
    this.enqueueEvent("sessionCancelRequested", {
      session: this.toSnapshot(record),
      reason,
    });
    this.persistSession(record);

    // Handle PI sessions
    const piRuntime = this.piRuntimes.get(sessionId);
    if (piRuntime) {
      try {
        piRuntime.abortController.abort();
      } catch {}
      try {
        piRuntime.unsubscribe();
      } catch {}
      this.finalizeSession(record, {
        status: "cancelled",
        exitCode: null,
        signalCode: null,
      });
      return true;
    }

    if (record.pid == null) {
      this.removeFromQueue(sessionId);
      this.finalizeSession(record, {
        status: "cancelled",
        exitCode: null,
        signalCode: null,
      });
      return true;
    }
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) {
      this.finalizeSession(record, {
        status: "cancelled",
        exitCode: record.exitCode ?? null,
        signalCode: record.signalCode ?? null,
      });
      return true;
    }
    runtime.cancelRequested = true;
    runtime.cancelReason = reason;
    try {
      runtime.abortController.abort();
    } catch {}
    try {
      runtime.subprocess.kill("SIGTERM");
    } catch {}
    if (runtime.killEscalationTimer) clearTimeout(runtime.killEscalationTimer);
    runtime.killEscalationTimer = setTimeout(() => {
      try {
        runtime.subprocess.kill("SIGKILL");
      } catch {}
    }, this.cancelKillGraceMs);
    return true;
  }

  /**
   * Send a message to a running PI session.
   * If the agent is streaming, the message is queued as a follow-up.
   * @throws Error if session not found, not a PI session, or not in running state
   */
  async sendFollowUp(sessionId: SessionId, text: string): Promise<void> {
    this.assertUsable();
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Message text cannot be empty.");

    const record = this.sessions.get(sessionId);
    if (!record) throw new Error(`Unknown session "${sessionId}".`);
    if (record.runtimeType !== "pi-sdk")
      throw new Error(`Session "${sessionId}" is not a PI session.`);

    let piRuntime = this.piRuntimes.get(sessionId);
    if (!piRuntime) {
      if (!record.canResume || !record.piSessionFile) {
        throw new Error(
          `Session "${sessionId}" is not running (status: ${record.status}).`,
        );
      }
      piRuntime = await this.resumePiSession(sessionId, record);
    }
    if (!piRuntime)
      throw new Error(`Session "${sessionId}" has no active PI runtime.`);

    // Append user message to transcript immediately for UI feedback
    const userMessage: TranscriptMessage = {
      id: this.generateId(),
      role: "user",
      text: trimmed,
      timestamp: this.now(),
    };
    record.transcriptBuffer.append(userMessage);
    this.enqueueEvent("sessionTranscriptUpdate", {
      sessionId,
      session: this.toSnapshot(record),
      message: userMessage,
    });

    // If agent is streaming, queue as follow-up; otherwise send directly
    if (piRuntime.agentSession.isStreaming) {
      console.log("Agent is streaming, using followUp");
      try {
        await piRuntime.agentSession.followUp(trimmed);
        console.log("followUp completed successfully");
      } catch (error) {
        console.error("followUp error:", error);
        this.handleSendError(sessionId, record, error);
      }
      return;
    }

    console.log("Agent not streaming, using prompt");
    this.activeSessions.add(sessionId);
    try {
      await piRuntime.agentSession.prompt(trimmed);
      console.log("prompt completed successfully");
      this.activeSessions.delete(sessionId);
      this.pumpQueue();
    } catch (error) {
      console.error("prompt error:", error);
      this.activeSessions.delete(sessionId);
      this.pumpQueue();
      this.handleSendError(sessionId, record, error);
    }
  }

  private handleSendError(
    sessionId: SessionId,
    record: SessionRecord,
    error: unknown,
  ): void {
    console.error("handleSendError called with:", error);
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error message:", message);
    const recoverable = this.isRecoverableError(message);
    record.error = message;
    this.persistSession(record);

    // Append error as transcript message for display in chat
    const errorMessage: TranscriptMessage = {
      id: this.generateId(),
      role: "error",
      text: message,
      timestamp: this.now(),
    };
    record.transcriptBuffer.append(errorMessage);
    console.log("Appended error to transcript, enqueuing event");
    this.enqueueEvent("sessionTranscriptUpdate", {
      sessionId,
      session: this.toSnapshot(record),
      message: errorMessage,
    });

    this.enqueueEvent("sessionError", {
      sessionId,
      session: this.toSnapshot(record),
      error: message,
      recoverable,
    });
  }

  private isRecoverableError(message: string): boolean {
    const lower = message.toLowerCase();
    return (
      lower.includes("429") ||
      lower.includes("rate limit") ||
      lower.includes("timeout") ||
      lower.includes("econnreset") ||
      lower.includes("enotfound") ||
      lower.includes("network") ||
      lower.includes("5") ||
      lower.includes("503") ||
      lower.includes("502")
    );
  }

  async hydrateSessionHistory(sessionId: SessionId): Promise<void> {
    this.assertUsable();
    const record = this.sessions.get(sessionId);
    if (!record) throw new Error(`Unknown session "${sessionId}".`);
    if (record.runtimeType !== "pi-sdk") return;
    if (record.transcriptBuffer.getSummary().retainedMessages > 0) return;
    if (!record.canResume || !record.piSessionFile) return;

    if (!existsSync(record.piSessionFile)) {
      record.canResume = false;
      record.error = `Persisted PI session file not found: ${record.piSessionFile}`;
      record.recovered = true;
      this.persistSession(record);
      return;
    }

    const history = await this.piRunner.loadHistory({
      cwd: record.cwd,
      sessionFile: record.piSessionFile,
    });

    for (const message of history) {
      record.transcriptBuffer.append(message);
      this.enqueueEvent("sessionTranscriptUpdate", {
        sessionId,
        session: this.toSnapshot(record),
        message,
      });
    }
  }

  getSession(sessionId: SessionId): SessionSnapshot | undefined {
    const record = this.sessions.get(sessionId);
    return record ? this.toSnapshot(record) : undefined;
  }

  listSessions(): SessionSnapshot[] {
    return this.sessionOrder
      .map((id) => this.sessions.get(id))
      .filter((record): record is SessionRecord => record != null)
      .map((record) => this.toSnapshot(record));
  }

  getSessionLogs(sessionId: SessionId): readonly SessionLogLine[] {
    const record = this.sessions.get(sessionId);
    return record ? record.logBuffer.snapshot() : [];
  }

  getSessionTranscripts(sessionId: SessionId): readonly TranscriptMessage[] {
    const record = this.sessions.get(sessionId);
    return record ? record.transcriptBuffer.snapshot() : [];
  }

  waitForSession(sessionId: SessionId): Promise<SessionSnapshot> {
    const record = this.sessions.get(sessionId);
    if (!record)
      return Promise.reject(new Error(`Unknown session "${sessionId}".`));
    return record.completion;
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown || this.disposed) return;
    this.shuttingDown = true;
    for (const sessionId of [...this.queue])
      this.cancelSession(sessionId, "shutdown");
    for (const sessionId of [...this.activeSessions])
      this.cancelSession(sessionId, "shutdown");
    const pending = [...this.sessions.values()]
      .filter((record) => !isTerminalStatus(record.status))
      .map((record) => record.completion.then(() => undefined));
    if (pending.length > 0) {
      await Promise.race([
        Promise.allSettled(pending),
        sleep(this.cancelKillGraceMs + 1000),
      ]);
    }
    this.forceTerminateAll("SIGKILL");
    this.cleanupPiRuntimes();
    this.eventBus.flushNow();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    process.removeListener("beforeExit", this.handleBeforeExit);
    process.removeListener("exit", this.handleExit);
    await this.shutdown();
    this.cleanupPiRuntimes();
    this.eventBus.dispose();
    this.disposed = true;
  }

  private cleanupPiRuntimes(): void {
    for (const [sessionId, piRuntime] of this.piRuntimes) {
      try {
        piRuntime.abortController.abort();
      } catch {}
      try {
        piRuntime.unsubscribe();
      } catch {}
      try {
        piRuntime.agentSession.dispose();
      } catch {}
      this.piRuntimes.delete(sessionId);
    }
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error("SessionManager has been disposed.");
  }

  private pumpQueue(): void {
    if (this.shuttingDown) return;
    while (this.activeSessions.size < this.maxConcurrent) {
      const nextSessionId = this.dequeueNextQueuedSession();
      if (!nextSessionId) return;
      this.startSession(nextSessionId);
    }
  }

  private dequeueNextQueuedSession(): SessionId | undefined {
    while (this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) return undefined;
      const record = this.sessions.get(next);
      if (!record) continue;
      if (record.status !== "queued") continue;
      return next;
    }
    return undefined;
  }

  private startSession(sessionId: SessionId): void {
    const record = this.sessions.get(sessionId);
    if (!record || record.status !== "queued") return;
    record.status = "starting";
    record.startedAt = this.now();
    this.activeSessions.add(sessionId);
    this.enqueueEvent("sessionStarting", { session: this.toSnapshot(record) });
    this.persistSession(record);

    if (record.metadata?.isPiSession) {
      this.startPiSession(sessionId, record);
      return;
    }

    try {
      const { pid, runtime } = this.processRunner.start({
        sessionId: record.id,
        command: record.command,
        cwd: record.cwd,
        env: record.env,
      });
      record.pid = pid;
      record.status = "running";
      this.runtimes.set(record.id, runtime);
      this.enqueueEvent("sessionStarted", {
        session: this.toSnapshot(record),
        pid,
      });
      this.persistSession(record);
    } catch (error) {
      this.activeSessions.delete(record.id);
      const message = error instanceof Error ? error.message : String(error);
      this.finalizeSession(record, {
        status: "failed",
        exitCode: null,
        signalCode: null,
        error: message,
      });
    }
  }

  private async startPiSession(
    sessionId: SessionId,
    record: SessionRecord,
  ): Promise<void> {
    try {
      const prompt = record.metadata?.prompt as string | undefined;
      const hasPrompt = Boolean(prompt?.trim());
      const {
        runtime,
        persistedSessionId,
        persistedSessionFile,
        history,
      } = await this.piRunner.start({
        sessionId,
        cwd: record.cwd,
        prompt,
        sessionFile: record.piSessionFile,
      });

      if (record.transcriptBuffer.getSummary().retainedMessages === 0) {
        for (const message of history) {
          record.transcriptBuffer.append(message);
          this.enqueueEvent("sessionTranscriptUpdate", {
            sessionId,
            session: this.toSnapshot(record),
            message,
          });
        }
      }

      this.piRuntimes.set(sessionId, runtime);
      record.piRuntime = runtime;
      record.runtimeType = "pi-sdk";
      record.piSessionId = persistedSessionId;
      record.piSessionFile = persistedSessionFile;
      record.canResume = Boolean(persistedSessionFile);
      record.status = "running";
      record.recovered = false;

      this.enqueueEvent("sessionStarted", {
        session: this.toSnapshot(record),
        pid: -1,
      });
      this.persistSession(record);

      if (hasPrompt && prompt) {
        this.piRunner.startPrompt(sessionId, runtime, prompt);
      } else {
        this.activeSessions.delete(sessionId);
        this.pumpQueue();
      }
    } catch (error) {
      this.activeSessions.delete(sessionId);
      const message = error instanceof Error ? error.message : String(error);
      this.finalizeSession(record, {
        status: "failed",
        exitCode: null,
        signalCode: null,
        error: message,
      });
    }
  }

  private async resumePiSession(
    sessionId: SessionId,
    record: SessionRecord,
  ): Promise<PiSessionRuntime> {
    if (!record.piSessionFile) {
      throw new Error(
        `Session "${sessionId}" has no persisted PI session file.`,
      );
    }
    if (!existsSync(record.piSessionFile)) {
      record.canResume = false;
      record.error = `Persisted PI session file not found: ${record.piSessionFile}`;
      this.persistSession(record);
      throw new Error(record.error);
    }

    record.status = "starting";
    record.startedAt = this.now();
    this.activeSessions.add(sessionId);
    this.enqueueEvent("sessionStarting", { session: this.toSnapshot(record) });
    this.persistSession(record);

    try {
      const { runtime, persistedSessionId, persistedSessionFile, history } =
        await this.piRunner.start({
          sessionId,
          cwd: record.cwd,
          sessionFile: record.piSessionFile,
        });

      if (record.transcriptBuffer.getSummary().retainedMessages === 0) {
        for (const message of history) {
          record.transcriptBuffer.append(message);
          this.enqueueEvent("sessionTranscriptUpdate", {
            sessionId,
            session: this.toSnapshot(record),
            message,
          });
        }
      }

      this.piRuntimes.set(sessionId, runtime);
      record.piRuntime = runtime;
      record.runtimeType = "pi-sdk";
      record.piSessionId = persistedSessionId;
      record.piSessionFile = persistedSessionFile;
      record.canResume = Boolean(persistedSessionFile);
      record.status = "running";
      record.recovered = false;
      record.error = undefined;

      this.enqueueEvent("sessionStarted", {
        session: this.toSnapshot(record),
        pid: -1,
      });
      this.persistSession(record);
      this.activeSessions.delete(sessionId);
      this.pumpQueue();
      return runtime;
    } catch (error) {
      this.activeSessions.delete(sessionId);
      const message = error instanceof Error ? error.message : String(error);
      record.status = "failed";
      record.finishedAt = this.now();
      record.error = message;
      this.enqueueEvent("sessionFailed", {
        session: this.toSnapshot(record),
        exitCode: null,
        signalCode: null,
        error: message,
      });
      this.persistSession(record);
      this.pumpQueue();
      throw error;
    }
  }

  private appendTranscriptMessage(
    sessionId: SessionId,
    message: TranscriptMessage,
  ): void {
    const record = this.sessions.get(sessionId);
    if (!record) return;
    record.transcriptBuffer.append(message);
    this.enqueueEvent("sessionTranscriptUpdate", {
      sessionId,
      session: this.toSnapshot(record),
      message,
    });
  }

  private updateTranscriptMessage(
    sessionId: SessionId,
    message: TranscriptMessage,
  ): void {
    const record = this.sessions.get(sessionId);
    if (!record) return;
    record.transcriptBuffer.update(message);
    this.enqueueEvent("sessionTranscriptUpdate", {
      sessionId,
      session: this.toSnapshot(record),
      message,
    });
  }

  private appendLogLines(
    sessionId: SessionId,
    lines: readonly SessionLogLine[],
  ): void {
    if (lines.length === 0) return;
    const record = this.sessions.get(sessionId);
    if (!record) return;
    record.logBuffer.append(lines);
    this.eventBus.enqueueLogBatch(sessionId, lines);
  }

  private finalizeSession(
    record: SessionRecord,
    result: {
      status: "cancelled" | "succeeded" | "failed";
      exitCode: number | null;
      signalCode: string | null;
      error?: string;
    },
  ): void {
    if (isTerminalStatus(record.status)) return;
    record.status = result.status;
    record.finishedAt = this.now();
    record.exitCode = result.exitCode;
    record.signalCode = result.signalCode;
    record.error = result.error;
    this.activeSessions.delete(record.id);
    this.removeFromQueue(record.id);
    const runtime = this.runtimes.get(record.id);
    if (runtime?.killEscalationTimer) clearTimeout(runtime.killEscalationTimer);
    this.runtimes.delete(record.id);

    const piRuntime = this.piRuntimes.get(record.id);
    if (piRuntime) {
      try {
        piRuntime.abortController.abort();
      } catch {}
      try {
        piRuntime.unsubscribe();
      } catch {}
      try {
        piRuntime.agentSession.dispose();
      } catch {}
      this.piRuntimes.delete(record.id);
      record.piRuntime = undefined;
    }

    const snapshot = this.toSnapshot(record);
    switch (result.status) {
      case "cancelled":
        this.enqueueEvent("sessionCancelled", {
          session: snapshot,
          exitCode: result.exitCode,
          signalCode: result.signalCode,
        });
        break;
      case "succeeded":
        this.enqueueEvent("sessionSucceeded", {
          session: snapshot,
          exitCode: result.exitCode ?? 0,
        });
        break;
      case "failed":
        this.enqueueEvent("sessionFailed", {
          session: snapshot,
          exitCode: result.exitCode,
          signalCode: result.signalCode,
          error: result.error,
        });
        break;
    }
    if (!record.completed) {
      record.completed = true;
      record.resolveCompletion(snapshot);
    }
    this.persistSession(record);
    this.pumpQueue();
  }

  private toSnapshot(record: SessionRecord): SessionSnapshot {
    const isRunningPiSession =
      record.runtimeType === "pi-sdk" && record.status === "running";
    const canResumePiSession =
      record.runtimeType === "pi-sdk" &&
      Boolean(record.canResume && record.piSessionFile);
    return {
      id: record.id,
      title: record.title,
      command: [...record.command],
      cwd: record.cwd,
      metadata: cloneMetadata(record.metadata),
      status: record.status,
      pid: record.pid,
      queuedAt: record.queuedAt,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      cancelRequestedAt: record.cancelRequestedAt,
      exitCode: record.exitCode,
      signalCode: record.signalCode,
      error: record.error,
      logSummary: record.logBuffer.getSummary(),
      transcriptSummary: record.transcriptBuffer.getSummary(),
      runtimeType: record.runtimeType,
      canResume: canResumePiSession,
      piSessionFile: record.piSessionFile,
      canSendFollowUp: isRunningPiSession || canResumePiSession,
      worktreeId: record.worktreeId,
    };
  }

  private enqueueEvent<K extends NonLogEventName>(
    type: K,
    payload: SessionManagerEventMap[K],
  ): void {
    this.eventBus.enqueueEvent(type, payload);
  }

  private removeFromQueue(sessionId: SessionId): void {
    const index = this.queue.indexOf(sessionId);
    if (index >= 0) this.queue.splice(index, 1);
  }

  private forceTerminateAll(signal: NodeJS.Signals): void {
    for (const runtime of this.runtimes.values()) {
      try {
        runtime.subprocess.kill(signal);
      } catch {}
      if (runtime.killEscalationTimer) {
        clearTimeout(runtime.killEscalationTimer);
        runtime.killEscalationTimer = null;
      }
    }
  }

  private persistSession(record: SessionRecord): void {
    try {
      this.repository.updateSession(record.id, {
        title: record.title,
        prompt: record.metadata?.prompt as string | undefined,
        runtimeType: record.runtimeType ?? "subprocess",
        status: record.status,
        originalCwd: record.originalCwd,
        effectiveCwd: record.effectiveCwd,
        repoRoot: record.repoRoot,
        worktreePath: record.worktreePath,
        worktreeId: record.worktreeId,
        worktreeStatus: record.worktreeStatus ?? "none",
        cleanupPolicy: record.cleanupPolicy ?? "preserve_on_failure",
        cleanupStatus: record.cleanupStatus ?? "none",
        piSessionId: record.piSessionId,
        piSessionFile: record.piSessionFile,
        canResume: record.canResume ?? false,
        recovered: record.recovered ?? false,
        lastError: record.error,
        queuedAt: record.queuedAt,
        startedAt: record.startedAt,
        finishedAt: record.finishedAt,
        cancelRequestedAt: record.cancelRequestedAt,
      });
    } catch (error) {
      console.error(
        `[SessionManager] Failed to persist session ${record.id}:`,
        error,
      );
    }
  }

  rehydrateFromPersistence(): void {
    this.assertUsable();
    const persistedSessions = this.repository.listSessions();

    // Get known worktree IDs for validation
    const knownWorktreeIds = new Set(
      this.worktreeRepository.listWorktrees().map((w) => w.id),
    );

    for (const persisted of persistedSessions) {
      // Skip if already loaded
      if (this.sessions.has(persisted.id)) continue;

      // WORKTREE-FIRST FILTERING:
      // 1. Skip legacy sessions without worktreeId - they don't belong in worktree-first UI
      if (!persisted.worktreeId) {
        continue;
      }

      // 2. Handle orphaned sessions: worktreeId points to unknown/invalid worktree
      if (!knownWorktreeIds.has(persisted.worktreeId)) {
        // Create a recovered/failed record for the orphaned session
        // but don't add it to active sessions - it's filtered from UI
        this.createOrphanedSessionRecord(persisted);
        continue;
      }

      // Reconcile persisted state
      let status = persisted.status;
      let recovered = Boolean(persisted.recovered);
      let lastError = persisted.lastError;
      const isPiSession = persisted.runtimeType === "pi-sdk";
      const hasPiSessionFile = Boolean(
        persisted.piSessionFile && existsSync(persisted.piSessionFile),
      );
      let canResume = isPiSession && hasPiSessionFile;

      if (isPiSession && persisted.piSessionFile && !hasPiSessionFile) {
        recovered = true;
        canResume = false;
        lastError = `Persisted PI session file not found: ${persisted.piSessionFile}`;
      }

      // Convert interrupted active sessions to recovered non-active state
      // This includes queued, starting, running, and cancelling statuses
      // that were active when the app was last shutdown
      if (
        status === "queued" ||
        status === "starting" ||
        status === "running" ||
        status === "cancelling"
      ) {
        status = "failed";
        recovered = true;
        if (!lastError) {
          lastError = "Session interrupted by app restart";
        }
      }

      let resolveCompletion!: (snapshot: SessionSnapshot) => void;
      const completion = new Promise<SessionSnapshot>((resolve) => {
        resolveCompletion = resolve;
      });

      const record: SessionRecord = {
        id: persisted.id,
        title: persisted.title,
        command: ["pi-sdk-session"], // We'll need to persist command separately if needed
        cwd: persisted.effectiveCwd,
        status: status as SessionStatus,
        queuedAt: persisted.queuedAt,
        startedAt: persisted.startedAt,
        finishedAt: persisted.finishedAt,
        cancelRequestedAt: persisted.cancelRequestedAt,
        exitCode: null,
        signalCode: null,
        error: lastError,
        logBuffer: this.createLogBuffer(),
        transcriptBuffer: new TranscriptRingBuffer(),
        completion,
        resolveCompletion,
        completed: isTerminalStatus(status as SessionStatus),
        runtimeType: persisted.runtimeType as SessionRuntimeType,
        worktreeId: persisted.worktreeId,
        originalCwd: persisted.originalCwd,
        effectiveCwd: persisted.effectiveCwd,
        repoRoot: persisted.repoRoot,
        worktreePath: persisted.worktreePath,
        worktreeStatus: persisted.worktreeStatus,
        cleanupPolicy: persisted.cleanupPolicy,
        cleanupStatus: persisted.cleanupStatus,
        piSessionId: persisted.piSessionId,
        piSessionFile: persisted.piSessionFile,
        canResume,
        recovered: recovered,
        metadata: {
          prompt: persisted.prompt,
          isPiSession,
        },
      };

      this.sessions.set(record.id, record);
      this.sessionOrder.push(record.id);

      // After restart reconciliation, all sessions should be in terminal states
      // or queued state. Active states (starting/running/cancelling) are converted
      // to failed/recovered during rehydration above.
      if (isTerminalStatus(status as SessionStatus)) {
        if (!record.completed) {
          record.completed = true;
          record.resolveCompletion(this.toSnapshot(record));
        }
      } else {
        // Status is "queued" - add to queue for processing
        this.queue.push(record.id);
      }

      // Update persistence with reconciled state
      if (
        recovered !== persisted.recovered ||
        status !== persisted.status ||
        lastError !== persisted.lastError ||
        canResume !== persisted.canResume
      ) {
        this.repository.updateSession(record.id, {
          status: status as SessionStatus,
          recovered,
          lastError,
          canResume,
          worktreeStatus: record.worktreeStatus,
        });
      }
    }
  }

  /**
   * Creates a recovered session record for orphaned sessions (sessions whose
   * worktreeId points to an unknown/invalid worktree).
   * These sessions are marked as recovered with an error but NOT added to active
   * sessions - they are filtered from the worktree-first UI.
   */
  private createOrphanedSessionRecord(
    persisted: import("./persistence/types.js").PersistedSession,
  ): void {
    const error = `Orphaned session: worktree "${persisted.worktreeId}" not found`;

    // Mark as failed and recovered
    this.repository.updateSession(persisted.id, {
      status: "failed",
      recovered: true,
      lastError: error,
      worktreeStatus: "removed",
    });
  }
}
