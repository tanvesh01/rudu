import type {
  NonLogEventName,
  PendingEvent,
  SessionId,
  SessionListener,
  SessionLogLine,
  SessionLogSummary,
  SessionManagerEventMap,
  SessionSnapshot,
} from "./types.js";

interface SessionEventBusOptions {
  eventThrottleMs: number;
  getLogPayload: (
    sessionId: SessionId,
  ) => { session: SessionSnapshot; logSummary: SessionLogSummary } | undefined;
}

export class SessionEventBus {
  private listeners = new Map<
    keyof SessionManagerEventMap,
    Set<(payload: unknown) => void>
  >();
  private pendingEventQueue: PendingEvent[] = [];
  private pendingLogBatches = new Map<SessionId, SessionLogLine[]>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private options: SessionEventBusOptions) {}

  on<K extends keyof SessionManagerEventMap>(
    event: K,
    listener: SessionListener<K>,
  ): () => void {
    const existing = this.listeners.get(event) ?? new Set();
    existing.add(listener as (payload: unknown) => void);
    this.listeners.set(event, existing);
    return () => this.off(event, listener);
  }

  off<K extends keyof SessionManagerEventMap>(
    event: K,
    listener: SessionListener<K>,
  ): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(listener as (payload: unknown) => void);
    if (set.size === 0) this.listeners.delete(event);
  }

  enqueueEvent<K extends NonLogEventName>(
    type: K,
    payload: SessionManagerEventMap[K],
  ): void {
    this.pendingEventQueue.push({ kind: "event", type, payload });
    this.scheduleFlush();
  }

  enqueueLogBatch(
    sessionId: SessionId,
    lines: readonly SessionLogLine[],
  ): void {
    if (lines.length === 0) return;

    const existingBatch = this.pendingLogBatches.get(sessionId);
    if (existingBatch) {
      existingBatch.push(...lines);
    } else {
      this.pendingLogBatches.set(sessionId, [...lines]);
      this.pendingEventQueue.push({ kind: "log", sessionId });
    }

    this.scheduleFlush();
  }

  flushNow(): void {
    const queue = this.pendingEventQueue;
    const logBatches = this.pendingLogBatches;
    this.pendingEventQueue = [];
    this.pendingLogBatches = new Map();

    for (const item of queue) {
      if (item.kind === "event") {
        this.deliver(item.type, item.payload);
        continue;
      }

      const lines = logBatches.get(item.sessionId);
      if (!lines?.length) continue;
      const payload = this.options.getLogPayload(item.sessionId);
      if (!payload) continue;

      this.deliver("sessionLogBatch", {
        sessionId: item.sessionId,
        lines,
        ...payload,
      });
    }

    if (this.pendingEventQueue.length > 0) {
      this.scheduleFlush();
    }
  }

  dispose(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.pendingEventQueue = [];
    this.pendingLogBatches = new Map();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushNow();
    }, this.options.eventThrottleMs);
  }

  private deliver<K extends keyof SessionManagerEventMap>(
    type: K,
    payload: SessionManagerEventMap[K],
  ): void {
    const set = this.listeners.get(type);
    if (!set?.size) return;

    for (const listener of [...set]) {
      try {
        (listener as SessionListener<K>)(payload);
      } catch (error) {
        console.error(
          `[SessionManager] listener for "${String(type)}" failed`,
          error,
        );
      }
    }
  }
}
