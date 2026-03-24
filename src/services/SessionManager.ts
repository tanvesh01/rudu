// src/services/SessionManager.ts

import {
  AuthStorage,
  ModelRegistry,
  createAgentSession,
} from "@mariozechner/pi-coding-agent";
import type {
  AgentSession,
  SessionManager as PiSessionManager,
} from "@mariozechner/pi-coding-agent";
import type {
  TranscriptMessage,
  TranscriptMessageDelta,
  TranscriptRole,
} from "../domain/transcript.js";

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
  /** The runtime type for this session */
  runtimeType?: SessionRuntimeType;
  /** Whether this session can accept follow-up messages */
  canSendFollowUp: boolean;
}

export type { TranscriptMessage };

export type SessionRuntimeType = "subprocess" | "pi-sdk";

export interface SessionManagerEventMap {
  sessionQueued: { session: SessionSnapshot };
  sessionStarting: { session: SessionSnapshot };
  sessionStarted: { session: SessionSnapshot; pid: number };
  sessionLogBatch: { sessionId: SessionId; session: SessionSnapshot; lines: readonly SessionLogLine[]; logSummary: SessionLogSummary };
  sessionTranscriptUpdate: { sessionId: SessionId; session: SessionSnapshot; message: TranscriptMessage };
  sessionCancelRequested: { session: SessionSnapshot; reason: SessionCancelReason };
  sessionCancelled: { session: SessionSnapshot; exitCode: number | null; signalCode: string | null };
  sessionSucceeded: { session: SessionSnapshot; exitCode: number };
  sessionFailed: { session: SessionSnapshot; exitCode: number | null; signalCode: string | null; error?: string };
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
  piAuthStorage?: AuthStorage;
  piModelRegistry?: ModelRegistry;
}

type SessionListener<K extends keyof SessionManagerEventMap> = (payload: SessionManagerEventMap[K]) => void;
type NonLogEventName = Exclude<keyof SessionManagerEventMap, "sessionLogBatch">;

type PendingEvent =
  | { kind: "event"; type: NonLogEventName; payload: SessionManagerEventMap[NonLogEventName] }
  | { kind: "log"; sessionId: SessionId };

interface PiSessionRuntime {
  agentSession: AgentSession;
  abortController: AbortController;
  unsubscribe: () => void;
}

interface SessionRecord {
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
}

interface SessionRuntime {
  subprocess: Bun.Subprocess<"ignore", "pipe", "pipe">;
  abortController: AbortController;
  stdoutTask: Promise<void>;
  stderrTask: Promise<void>;
  killEscalationTimer: ReturnType<typeof setTimeout> | null;
  cancelRequested: boolean;
  cancelReason?: SessionCancelReason;
}

interface InternalLogLine extends SessionLogLine {
  bytes: number;
}

const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_EVENT_THROTTLE_MS = 100;
const DEFAULT_LOG_BUFFER_MAX_LINES = 2000;
const DEFAULT_LOG_BUFFER_MAX_BYTES = 1000000;
const DEFAULT_CANCEL_KILL_GRACE_MS = 2500;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function isTerminalStatus(status: SessionStatus): boolean {
  return status === "cancelled" || status === "succeeded" || status === "failed";
}

function utf8ByteLength(text: string): number {
  return textEncoder.encode(text).byteLength;
}

function truncateUtf8FromEnd(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const bytes = textEncoder.encode(text);
  if (bytes.byteLength <= maxBytes) return text;
  if (maxBytes <= 3) return textDecoder.decode(bytes.slice(bytes.byteLength - maxBytes));
  const tail = bytes.slice(bytes.byteLength - (maxBytes - 3));
  return `...${textDecoder.decode(tail)}`;
}

function cloneMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
  return metadata ? { ...metadata } : undefined;
}

function normalizeEnv(env?: Record<string, string>): Record<string, string> | undefined {
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

class SessionLogRingBuffer {
  private entries: InternalLogLine[] = [];
  private retainedBytes = 0;
  private droppedLines = 0;

  constructor(private maxLines: number, private maxBytes: number) {}

  append(lines: readonly SessionLogLine[]): SessionLogSummary {
    for (const line of lines) {
      let text = line.text;
      let bytes = utf8ByteLength(text) + 1;
      if (bytes > this.maxBytes) {
        text = truncateUtf8FromEnd(text, Math.max(1, this.maxBytes - 1));
        bytes = utf8ByteLength(text) + 1;
      }
      this.entries.push({ timestamp: line.timestamp, stream: line.stream, text, bytes });
      this.retainedBytes += bytes;
    }
    while (this.entries.length > this.maxLines || this.retainedBytes > this.maxBytes) {
      const removed = this.entries.shift();
      if (!removed) break;
      this.retainedBytes -= removed.bytes;
      this.droppedLines += 1;
    }
    return this.getSummary();
  }

  snapshot(): readonly SessionLogLine[] {
    return this.entries.map(({ bytes, ...line }) => ({ ...line }));
  }

  getSummary(): SessionLogSummary {
    return { retainedLines: this.entries.length, retainedBytes: this.retainedBytes, droppedLines: this.droppedLines };
  }
}

interface InternalTranscriptMessage extends TranscriptMessage {
  bytes: number;
}

class TranscriptRingBuffer {
  private entries: InternalTranscriptMessage[] = [];
  private retainedBytes = 0;
  private droppedMessages = 0;

  constructor(private maxLines: number = 1000, private maxBytes: number = 500000) {}

  append(message: TranscriptMessage): TranscriptSummary {
    let text = message.text ?? "";
    let bytes = utf8ByteLength(text) + 1;
    if (bytes > this.maxBytes) {
      text = truncateUtf8FromEnd(text, Math.max(1, this.maxBytes - 1));
      bytes = utf8ByteLength(text) + 1;
    }
    this.entries.push({ ...message, text, bytes });
    this.retainedBytes += bytes;

    while (this.entries.length > this.maxLines || this.retainedBytes > this.maxBytes) {
      const removed = this.entries.shift();
      if (!removed) break;
      this.retainedBytes -= removed.bytes;
      this.droppedMessages += 1;
    }
    return this.getSummary();
  }

  snapshot(): readonly TranscriptMessage[] {
    return this.entries.map(({ bytes, ...msg }) => ({ ...msg }));
  }

  getSummary(): TranscriptSummary {
    return { retainedMessages: this.entries.length, retainedBytes: this.retainedBytes, droppedMessages: this.droppedMessages };
  }

  update(message: TranscriptMessage): void {
    const index = this.entries.findIndex((e) => e.id === message.id);
    if (index === -1) return;
    const old = this.entries[index]!;
    let text = message.text ?? "";
    let bytes = utf8ByteLength(text) + 1;
    if (bytes > this.maxBytes) {
      text = truncateUtf8FromEnd(text, Math.max(1, this.maxBytes - 1));
      bytes = utf8ByteLength(text) + 1;
    }
    this.entries[index] = { ...message, text, bytes };
    this.retainedBytes += bytes - old.bytes;
  }
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
  private listeners = new Map<keyof SessionManagerEventMap, Set<(payload: unknown) => void>>();
  private pendingEventQueue: PendingEvent[] = [];
  private pendingLogBatches = new Map<SessionId, SessionLogLine[]>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private shuttingDown = false;
  private disposed = false;
  private createLogBuffer: () => SessionLogRingBuffer;

  private handleBeforeExit = () => { void this.shutdown(); };
  private handleExit = () => { this.forceTerminateAll("SIGTERM"); };

  constructor(options: SessionManagerOptions = {}) {
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.eventThrottleMs = options.eventThrottleMs ?? DEFAULT_EVENT_THROTTLE_MS;
    this.cancelKillGraceMs = options.cancelKillGraceMs ?? DEFAULT_CANCEL_KILL_GRACE_MS;
    this.now = options.now ?? (() => Date.now());
    this.generateId = options.generateId ?? (() => crypto.randomUUID());
    const logBufferMaxLines = options.logBufferMaxLines ?? DEFAULT_LOG_BUFFER_MAX_LINES;
    const logBufferMaxBytes = options.logBufferMaxBytes ?? DEFAULT_LOG_BUFFER_MAX_BYTES;
    this.createLogBuffer = () => new SessionLogRingBuffer(logBufferMaxLines, logBufferMaxBytes);
    if (options.autoInstallShutdownHooks ?? true) {
      process.once("beforeExit", this.handleBeforeExit);
      process.once("exit", this.handleExit);
    }
  }

  on<K extends keyof SessionManagerEventMap>(event: K, listener: SessionListener<K>): () => void {
    const existing = this.listeners.get(event) ?? new Set();
    existing.add(listener as (payload: unknown) => void);
    this.listeners.set(event, existing);
    return () => this.off(event, listener);
  }

  off<K extends keyof SessionManagerEventMap>(event: K, listener: SessionListener<K>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(listener as (payload: unknown) => void);
    if (set.size === 0) this.listeners.delete(event);
  }

  queueSession(input: QueueSessionInput): SessionSnapshot {
    this.assertUsable();
    const id = input.id ?? this.generateId();
    if (this.sessions.has(id)) throw new Error(`Session with id "${id}" already exists.`);
    const queuedAt = this.now();
    let resolveCompletion!: (snapshot: SessionSnapshot) => void;
    const completion = new Promise<SessionSnapshot>((resolve) => { resolveCompletion = resolve; });
    const record: SessionRecord = {
      id, title: input.title, command: [...input.command], cwd: input.cwd,
      env: normalizeEnv(input.env), metadata: cloneMetadata(input.metadata),
      status: "queued", queuedAt, logBuffer: this.createLogBuffer(),
      transcriptBuffer: new TranscriptRingBuffer(),
      completion, resolveCompletion, completed: false
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
    if (this.sessions.has(id)) throw new Error(`Session with id "${id}" already exists.`);
    const queuedAt = this.now();
    let resolveCompletion!: (snapshot: SessionSnapshot) => void;
    const completion = new Promise<SessionSnapshot>((resolve) => { resolveCompletion = resolve; });

    // Initialize with user prompt as first transcript message
    const initialTranscript: TranscriptMessage = {
      id: this.generateId(),
      role: "user",
      text: input.prompt,
      timestamp: queuedAt,
    };

    const transcriptBuffer = new TranscriptRingBuffer();
    transcriptBuffer.append(initialTranscript);

    const record: SessionRecord = {
      id, title: input.title, command: ["pi-sdk-session"], cwd: input.cwd,
      env: undefined, metadata: { ...cloneMetadata(input.metadata), prompt: input.prompt, isPiSession: true },
      status: "queued", queuedAt, logBuffer: this.createLogBuffer(),
      transcriptBuffer,
      runtimeType: "pi-sdk",
      completion, resolveCompletion, completed: false
    };
    this.sessions.set(id, record);
    this.sessionOrder.push(id);
    this.queue.push(id);
    this.enqueueEvent("sessionQueued", { session: this.toSnapshot(record) });
    this.enqueueEvent("sessionTranscriptUpdate", { sessionId: id, session: this.toSnapshot(record), message: initialTranscript });
    this.pumpQueue();
    return this.toSnapshot(record);
  }

  cancelSession(sessionId: SessionId, reason: SessionCancelReason = "user"): boolean {
    const record = this.sessions.get(sessionId);
    if (!record || isTerminalStatus(record.status)) return false;
    if (record.status === "cancelling") return true;
    record.cancelRequestedAt = this.now();
    record.status = "cancelling";
    this.enqueueEvent("sessionCancelRequested", { session: this.toSnapshot(record), reason });

    // Handle PI sessions
    const piRuntime = this.piRuntimes.get(sessionId);
    if (piRuntime) {
      try { piRuntime.abortController.abort(); } catch {}
      try { piRuntime.unsubscribe(); } catch {}
      this.finalizeSession(record, { status: "cancelled", exitCode: null, signalCode: null });
      return true;
    }

    if (record.pid == null) {
      this.removeFromQueue(sessionId);
      this.finalizeSession(record, { status: "cancelled", exitCode: null, signalCode: null });
      return true;
    }
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) {
      this.finalizeSession(record, { status: "cancelled", exitCode: record.exitCode ?? null, signalCode: record.signalCode ?? null });
      return true;
    }
    runtime.cancelRequested = true;
    runtime.cancelReason = reason;
    try { runtime.abortController.abort(); } catch {}
    try { runtime.subprocess.kill("SIGTERM"); } catch {}
    if (runtime.killEscalationTimer) clearTimeout(runtime.killEscalationTimer);
    runtime.killEscalationTimer = setTimeout(() => {
      try { runtime.subprocess.kill("SIGKILL"); } catch {}
    }, this.cancelKillGraceMs);
    return true;
  }

  /**
   * Send a follow-up message to a running PI session.
   * The message is queued and processed after the agent finishes its current turn.
   * @throws Error if session not found, not a PI session, or not in running state
   */
  async sendFollowUp(sessionId: SessionId, text: string): Promise<void> {
    this.assertUsable();
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Message text cannot be empty.");

    const record = this.sessions.get(sessionId);
    if (!record) throw new Error(`Unknown session "${sessionId}".`);
    if (record.runtimeType !== "pi-sdk") throw new Error(`Session "${sessionId}" is not a PI session.`);
    if (record.status !== "running") throw new Error(`Session "${sessionId}" is not running (status: ${record.status}).`);

    const piRuntime = this.piRuntimes.get(sessionId);
    if (!piRuntime) throw new Error(`Session "${sessionId}" has no active PI runtime.`);

    // Append user message to transcript immediately for UI feedback
    const userMessage: TranscriptMessage = {
      id: this.generateId(),
      role: "user",
      text: trimmed,
      timestamp: this.now(),
    };
    record.transcriptBuffer.append(userMessage);
    this.enqueueEvent("sessionTranscriptUpdate", { sessionId, session: this.toSnapshot(record), message: userMessage });

    // Send to PI SDK - followUp queues the message for after current turn
    await piRuntime.agentSession.followUp(trimmed);
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
    if (!record) return Promise.reject(new Error(`Unknown session "${sessionId}".`));
    return record.completion;
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown || this.disposed) return;
    this.shuttingDown = true;
    for (const sessionId of [...this.queue]) this.cancelSession(sessionId, "shutdown");
    for (const sessionId of [...this.activeSessions]) this.cancelSession(sessionId, "shutdown");
    const pending = [...this.sessions.values()]
      .filter((record) => !isTerminalStatus(record.status))
      .map((record) => record.completion.then(() => undefined));
    if (pending.length > 0) {
      await Promise.race([Promise.allSettled(pending), sleep(this.cancelKillGraceMs + 1000)]);
    }
    this.forceTerminateAll("SIGKILL");
    this.cleanupPiRuntimes();
    this.flushEventsNow();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    process.removeListener("beforeExit", this.handleBeforeExit);
    process.removeListener("exit", this.handleExit);
    await this.shutdown();
    this.cleanupPiRuntimes();
    this.disposed = true;
  }

  private cleanupPiRuntimes(): void {
    for (const [sessionId, piRuntime] of this.piRuntimes) {
      try { piRuntime.abortController.abort(); } catch {}
      try { piRuntime.unsubscribe(); } catch {}
      try { piRuntime.agentSession.dispose(); } catch {}
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

    const abortController = new AbortController();
    try {
      const subprocess = Bun.spawn({
        cmd: record.command, cwd: record.cwd, env: record.env,
        stdin: "ignore", stdout: "pipe", stderr: "pipe", signal: abortController.signal,
      });
      record.pid = subprocess.pid;
      record.status = "running";
      const runtime: SessionRuntime = {
        subprocess, abortController,
        stdoutTask: this.consumeStream(record.id, "stdout", subprocess.stdout),
        stderrTask: this.consumeStream(record.id, "stderr", subprocess.stderr),
        killEscalationTimer: null, cancelRequested: false
      };
      this.runtimes.set(record.id, runtime);
      this.enqueueEvent("sessionStarted", { session: this.toSnapshot(record), pid: subprocess.pid });
      void this.observeExit(record.id, runtime);
    } catch (error) {
      this.activeSessions.delete(record.id);
      const message = error instanceof Error ? error.message : String(error);
      this.finalizeSession(record, { status: "failed", exitCode: null, signalCode: null, error: message });
    }
  }

  private async startPiSession(sessionId: SessionId, record: SessionRecord): Promise<void> {
    const abortController = new AbortController();

    try {
      const authStorage = AuthStorage.create();
      const modelRegistry = new ModelRegistry(authStorage);

      const { session } = await createAgentSession({
        sessionManager: (await import("@mariozechner/pi-coding-agent")).SessionManager.inMemory(record.cwd ?? process.cwd()),
        authStorage,
        modelRegistry,
        cwd: record.cwd ?? process.cwd(),
      });

      // Track the current assistant message to accumulate deltas
      let currentAssistantMessageId: string | null = null;
      let currentAssistantMessageText = "";
      // Track the current tool burst message ID for coalescing consecutive tool calls
      let currentToolBurstId: string | null = null;

      const unsubscribe = session.subscribe((event) => {
        switch (event.type) {
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
            this.finalizeSession(record, { status: "succeeded", exitCode: 0, signalCode: null });
            break;
          }
        }
      });

      const piRuntime: PiSessionRuntime = {
        agentSession: session,
        abortController,
        unsubscribe,
      };
      this.piRuntimes.set(sessionId, piRuntime);
      record.piRuntime = piRuntime;
      record.runtimeType = "pi-sdk";
      record.status = "running";

      this.enqueueEvent("sessionStarted", { session: this.toSnapshot(record), pid: -1 });

      const prompt = record.metadata?.prompt as string | undefined;
      if (prompt) {
        void session.prompt(prompt);
      }
    } catch (error) {
      this.activeSessions.delete(sessionId);
      const message = error instanceof Error ? error.message : String(error);
      this.finalizeSession(record, { status: "failed", exitCode: null, signalCode: null, error: message });
    }
  }

  private appendTranscriptMessage(sessionId: SessionId, message: TranscriptMessage): void {
    const record = this.sessions.get(sessionId);
    if (!record) return;
    record.transcriptBuffer.append(message);
    this.enqueueEvent("sessionTranscriptUpdate", { sessionId, session: this.toSnapshot(record), message });
  }

  private updateTranscriptMessage(sessionId: SessionId, message: TranscriptMessage): void {
    const record = this.sessions.get(sessionId);
    if (!record) return;
    record.transcriptBuffer.update(message);
    this.enqueueEvent("sessionTranscriptUpdate", { sessionId, session: this.toSnapshot(record), message });
  }

  private async observeExit(sessionId: SessionId, runtime: SessionRuntime): Promise<void> {
    const record = this.sessions.get(sessionId);
    if (!record) return;
    let exitCode: number | null = null;
    let signalCode: string | null = null;
    try { exitCode = await runtime.subprocess.exited; } catch { exitCode = runtime.subprocess.exitCode; }
    signalCode = runtime.subprocess.signalCode ?? null;
    await Promise.allSettled([runtime.stdoutTask, runtime.stderrTask]);
    if (runtime.killEscalationTimer) { clearTimeout(runtime.killEscalationTimer); runtime.killEscalationTimer = null; }
    this.runtimes.delete(sessionId);
    if (runtime.cancelRequested || record.status === "cancelling") {
      this.finalizeSession(record, { status: "cancelled", exitCode: exitCode ?? runtime.subprocess.exitCode ?? null, signalCode });
      return;
    }
    if ((exitCode ?? runtime.subprocess.exitCode ?? 1) === 0) {
      this.finalizeSession(record, { status: "succeeded", exitCode: exitCode ?? 0, signalCode });
      return;
    }
    this.finalizeSession(record, { status: "failed", exitCode: exitCode ?? runtime.subprocess.exitCode ?? null, signalCode, error: record.error });
  }

  private async consumeStream(sessionId: SessionId, stream: "stdout" | "stderr", readable: ReadableStream<Uint8Array> | undefined): Promise<void> {
    if (!readable) return;
    const reader = readable.pipeThrough(new TextDecoderStream()).getReader();
    let pending = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        const chunk = pending + value;
        const parts = chunk.split(/\r?\n/g);
        pending = parts.pop() ?? "";
        if (parts.length > 0) {
          this.appendLogLines(sessionId, parts.map((text) => ({ timestamp: this.now(), stream, text })));
        }
      }
      if (pending.length > 0) {
        this.appendLogLines(sessionId, [{ timestamp: this.now(), stream, text: pending }]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.appendLogLines(sessionId, [{ timestamp: this.now(), stream: "system", text: `[session-manager] ${stream} stream error: ${message}` }]);
    } finally {
      reader.releaseLock();
    }
  }

  private appendLogLines(sessionId: SessionId, lines: readonly SessionLogLine[]): void {
    if (lines.length === 0) return;
    const record = this.sessions.get(sessionId);
    if (!record) return;
    record.logBuffer.append(lines);
    const existingBatch = this.pendingLogBatches.get(sessionId);
    if (existingBatch) { existingBatch.push(...lines); }
    else {
      this.pendingLogBatches.set(sessionId, [...lines]);
      this.pendingEventQueue.push({ kind: "log", sessionId });
    }
    this.scheduleFlush();
  }

  private finalizeSession(record: SessionRecord, result: { status: "cancelled" | "succeeded" | "failed"; exitCode: number | null; signalCode: string | null; error?: string }): void {
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
    const snapshot = this.toSnapshot(record);
    switch (result.status) {
      case "cancelled": this.enqueueEvent("sessionCancelled", { session: snapshot, exitCode: result.exitCode, signalCode: result.signalCode }); break;
      case "succeeded": this.enqueueEvent("sessionSucceeded", { session: snapshot, exitCode: result.exitCode ?? 0 }); break;
      case "failed": this.enqueueEvent("sessionFailed", { session: snapshot, exitCode: result.exitCode, signalCode: result.signalCode, error: result.error }); break;
    }
    if (!record.completed) { record.completed = true; record.resolveCompletion(snapshot); }
    this.pumpQueue();
  }

  private toSnapshot(record: SessionRecord): SessionSnapshot {
    const isRunningPiSession = record.runtimeType === "pi-sdk" && record.status === "running";
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

  private enqueueEvent<K extends NonLogEventName>(type: K, payload: SessionManagerEventMap[K]): void {
    this.pendingEventQueue.push({ kind: "event", type, payload });
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flushEventsNow(); }, this.eventThrottleMs);
  }

  private flushEventsNow(): void {
    const queue = this.pendingEventQueue;
    const logBatches = this.pendingLogBatches;
    this.pendingEventQueue = [];
    this.pendingLogBatches = new Map();
    for (const item of queue) {
      if (item.kind === "event") { this.deliver(item.type, item.payload); continue; }
      const lines = logBatches.get(item.sessionId);
      if (!lines?.length) continue;
      const record = this.sessions.get(item.sessionId);
      if (!record) continue;
      this.deliver("sessionLogBatch", { sessionId: item.sessionId, session: this.toSnapshot(record), lines, logSummary: record.logBuffer.getSummary() });
    }
    if (this.pendingEventQueue.length > 0) this.scheduleFlush();
  }

  private deliver<K extends keyof SessionManagerEventMap>(type: K, payload: SessionManagerEventMap[K]): void {
    const set = this.listeners.get(type);
    if (!set?.size) return;
    for (const listener of [...set]) {
      try { (listener as SessionListener<K>)(payload); } catch (error) { console.error(`[SessionManager] listener for "${String(type)}" failed`, error); }
    }
  }

  private removeFromQueue(sessionId: SessionId): void {
    const index = this.queue.indexOf(sessionId);
    if (index >= 0) this.queue.splice(index, 1);
  }

  private forceTerminateAll(signal: NodeJS.Signals): void {
    for (const runtime of this.runtimes.values()) {
      try { runtime.subprocess.kill(signal); } catch {}
      if (runtime.killEscalationTimer) { clearTimeout(runtime.killEscalationTimer); runtime.killEscalationTimer = null; }
    }
  }
}
