// src/services/SessionManager.ts

import {
  AuthStorage,
  ModelRegistry,
  createAgentSession,
} from "@mariozechner/pi-coding-agent";
import type { TranscriptMessage } from "../domain/transcript.js";
import { SessionEventBus } from "./session-manager/event-bus.js";
import { SessionLogRingBuffer } from "./session-manager/log-buffer.js";
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
  private processRunner: ProcessSessionRunner;
  private shuttingDown = false;
  private disposed = false;
  private createLogBuffer: () => SessionLogRingBuffer;

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
    };
    this.sessions.set(id, record);
    this.sessionOrder.push(id);
    this.queue.push(id);
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
    };
    this.sessions.set(id, record);
    this.sessionOrder.push(id);
    this.queue.push(id);
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
   * If the agent is busy, the message is queued as a follow-up.
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
    if (record.status !== "running")
      throw new Error(
        `Session "${sessionId}" is not running (status: ${record.status}).`,
      );

    const piRuntime = this.piRuntimes.get(sessionId);
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

    const isBusy = piRuntime.isBusy || piRuntime.agentSession.isStreaming;
    if (isBusy) {
      await piRuntime.agentSession.prompt(trimmed, {
        streamingBehavior: "followUp",
      });
      return;
    }

    this.activeSessions.add(sessionId);
    piRuntime.isBusy = true;
    try {
      await piRuntime.agentSession.prompt(trimmed);
      piRuntime.isBusy = false;
      this.activeSessions.delete(sessionId);
      this.pumpQueue();
    } catch (error) {
      piRuntime.isBusy = false;
      this.activeSessions.delete(sessionId);
      this.pumpQueue();
      throw error;
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
    const abortController = new AbortController();

    try {
      const authStorage = AuthStorage.create();
      const modelRegistry = new ModelRegistry(authStorage);

      const { session } = await createAgentSession({
        sessionManager: (
          await import("@mariozechner/pi-coding-agent")
        ).SessionManager.inMemory(record.cwd ?? process.cwd()),
        authStorage,
        modelRegistry,
        cwd: record.cwd ?? process.cwd(),
      });

      // Track the current assistant message to accumulate deltas
      let currentAssistantMessageId: string | null = null;
      let currentAssistantMessageText = "";
      // Track the current tool burst message ID for coalescing consecutive tool calls
      let currentToolBurstId: string | null = null;

      let piRuntime: PiSessionRuntime | null = null;

      const unsubscribe = session.subscribe((event) => {
        switch (event.type) {
          case "agent_start": {
            if (piRuntime) {
              piRuntime.isBusy = true;
              this.activeSessions.add(sessionId);
            }
            break;
          }
          case "message_update": {
            const evt = event.assistantMessageEvent;
            if (evt.type === "text_delta" || evt.type === "thinking_delta") {
              const text = evt.delta ?? "";
              if (text) {
                // Break any active tool burst when assistant message starts
                if (currentToolBurstId != null) {
                  currentToolBurstId = null;
                }
                if (currentAssistantMessageId == null) {
                  // Start a new assistant message
                  currentAssistantMessageId = this.generateId();
                  currentAssistantMessageText = text;
                  const message: TranscriptMessage = {
                    id: currentAssistantMessageId,
                    role: "assistant",
                    text: currentAssistantMessageText,
                    timestamp: this.now(),
                  };
                  this.appendTranscriptMessage(sessionId, message);
                } else {
                  // Accumulate to existing message
                  currentAssistantMessageText += text;
                  const message: TranscriptMessage = {
                    id: currentAssistantMessageId,
                    role: "assistant",
                    text: currentAssistantMessageText,
                    timestamp: this.now(),
                  };
                  this.updateTranscriptMessage(sessionId, message);
                }
              }
            }
            break;
          }
          case "message_end": {
            // Reset message accumulation when message completes
            currentAssistantMessageId = null;
            currentAssistantMessageText = "";
            break;
          }
          case "tool_execution_start": {
            if (currentToolBurstId != null) {
              // Coalesce into existing tool burst
              const existingMessage = record.transcriptBuffer
                .snapshot()
                .find((m) => m.id === currentToolBurstId);
              if (existingMessage) {
                const updatedMessage: TranscriptMessage = {
                  id: currentToolBurstId,
                  role: "tool",
                  text: `${existingMessage.text}, ${event.toolName}`,
                  timestamp: this.now(),
                };
                this.updateTranscriptMessage(sessionId, updatedMessage);
              } else {
                // Message was dropped from buffer, start new burst
                currentToolBurstId = this.generateId();
                const message: TranscriptMessage = {
                  id: currentToolBurstId,
                  role: "tool",
                  text: event.toolName,
                  timestamp: this.now(),
                };
                this.appendTranscriptMessage(sessionId, message);
              }
            } else {
              // Start a new tool burst
              currentToolBurstId = this.generateId();
              const message: TranscriptMessage = {
                id: currentToolBurstId,
                role: "tool",
                text: event.toolName,
                timestamp: this.now(),
              };
              this.appendTranscriptMessage(sessionId, message);
            }
            break;
          }
          case "tool_execution_end": {
            // No-op - tool completion doesn't add to transcript
            break;
          }
          case "agent_end": {
            if (piRuntime) {
              piRuntime.isBusy = false;
              this.activeSessions.delete(sessionId);
              this.pumpQueue();
            }
            break;
          }
        }
      });

      const prompt = record.metadata?.prompt as string | undefined;
      const hasInitialPrompt =
        typeof prompt === "string" && prompt.trim().length > 0;

      piRuntime = {
        agentSession: session,
        abortController,
        unsubscribe,
        isBusy: hasInitialPrompt,
      };
      this.piRuntimes.set(sessionId, piRuntime);
      record.piRuntime = piRuntime;
      record.runtimeType = "pi-sdk";
      record.status = "running";

      this.enqueueEvent("sessionStarted", {
        session: this.toSnapshot(record),
        pid: -1,
      });

      if (hasInitialPrompt && prompt) {
        void session.prompt(prompt).catch((error) => {
          const message =
            error instanceof Error ? error.message : String(error);
          this.finalizeSession(record, {
            status: "failed",
            exitCode: null,
            signalCode: null,
            error: message,
          });
        });
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
    this.pumpQueue();
  }

  private toSnapshot(record: SessionRecord): SessionSnapshot {
    const isRunningPiSession =
      record.runtimeType === "pi-sdk" && record.status === "running";
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
      canSendFollowUp: isRunningPiSession,
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
}
