/**
 * Domain model for long-running Rudu sessions.
 *
 * Timestamps are stored as Unix epoch milliseconds (`Date.now()`), which keeps
 * them easy to serialize, compare, and format in the UI.
 */

/**
 * All valid lifecycle states for a session.
 */
export type SessionStatus =
  | "queued"
  | "starting"
  | "running"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled";

/**
 * Terminal states after which no further work should occur.
 */
export type TerminalSessionStatus = Extract<
  SessionStatus,
  "succeeded" | "failed" | "cancelled"
>;

/**
 * Maximum number of log lines that should be retained in memory per session.
 *
 * Note: the type system cannot enforce array length bounds; this constant exists
 * so reducers/state updates can clamp `logLines` consistently.
 */
export const MAX_SESSION_LOG_LINES = 500;

/**
 * Base shape shared by all session events.
 */
interface SessionEventBase<TType extends string> {
  /**
   * Discriminant for narrowing the event union.
   */
  readonly type: TType;

  /**
   * Session this event belongs to.
   */
  readonly sessionId: string;

  /**
   * Event timestamp in Unix epoch milliseconds.
   */
  readonly at: number;
}

/**
 * Emitted when a session is created and placed in the queue.
 */
export interface SessionQueuedEvent extends SessionEventBase<"sessionQueued"> {
  readonly prompt: string;
}

/**
 * Emitted when work begins preparing the session to run.
 */
export interface SessionStartingEvent
  extends SessionEventBase<"sessionStarting"> {}

/**
 * Emitted when the session process has actually started.
 */
export interface SessionStartedEvent extends SessionEventBase<"sessionStarted"> {
  readonly pid: number;
}

/**
 * Emitted when a batch of log lines is received.
 */
export interface SessionLogBatchEvent
  extends SessionEventBase<"sessionLogBatch"> {
  readonly lines: readonly string[];
}

/**
 * Emitted when a session is cancelled.
 */
export interface SessionCancelledEvent
  extends SessionEventBase<"sessionCancelled"> {
  readonly exitCode?: number;
}

/**
 * Emitted when a session completes successfully.
 */
export interface SessionSucceededEvent
  extends SessionEventBase<"sessionSucceeded"> {
  readonly exitCode: number;
}

/**
 * Emitted when a session completes unsuccessfully.
 */
export interface SessionFailedEvent extends SessionEventBase<"sessionFailed"> {
  readonly error: string;
  readonly exitCode?: number;
}

/**
 * All session events supported by the domain model.
 */
export type SessionEvent =
  | SessionQueuedEvent
  | SessionStartingEvent
  | SessionStartedEvent
  | SessionLogBatchEvent
  | SessionCancelledEvent
  | SessionSucceededEvent
  | SessionFailedEvent;

/**
 * Convenience alias for event names.
 */
export type SessionEventType = SessionEvent["type"];

/**
 * Full in-memory representation of a session.
 */
export interface Session {
  /**
   * Stable unique identifier.
   */
  readonly id: string;

  /**
   * Original user prompt or task description.
   */
  readonly prompt: string;

  /**
   * Current lifecycle state.
   */
  readonly status: SessionStatus;

  /**
   * Time the session was created/queued.
   */
  readonly createdAt: number;

  /**
   * Time the session actually began execution.
   */
  readonly startedAt?: number;

  /**
   * Time the session finished, failed, or was cancelled.
   */
  readonly endedAt?: number;

  /**
   * Process exit code when available.
   */
  readonly exitCode?: number;

  /**
   * OS process identifier when available.
   */
  readonly pid?: number;

  /**
   * Most recent event applied to this session.
   */
  readonly lastEvent?: SessionEvent;

  /**
   * Bounded in-memory log buffer. Keep this trimmed to
   * `MAX_SESSION_LOG_LINES` during updates.
   */
  readonly logLines: readonly string[];

  /**
   * Human-readable failure or cancellation error, if any.
   */
  readonly error?: string;
}

/**
 * Lightweight session shape intended for list views and other summary UIs.
 * Omits the full log buffer and replaces the full last event with a compact
 * event type plus log line count.
 */
export type SessionSummary = Omit<Session, "logLines" | "lastEvent"> & {
  /**
   * Number of log lines currently retained for the session.
   */
  readonly logLineCount: number;

  /**
   * Type of the most recent event, if known.
   */
  readonly lastEventType?: SessionEventType;
};

/**
 * Returns true when the given status is terminal.
 */
export function isTerminalStatus(
  status: SessionStatus,
): status is TerminalSessionStatus {
  switch (status) {
    case "succeeded":
    case "failed":
    case "cancelled":
      return true;
    default:
      return false;
  }
}

/**
 * Returns the elapsed session duration in milliseconds.
 *
 * Uses `startedAt` when available; otherwise falls back to `createdAt`.
 * Uses `endedAt` when available; otherwise measures until `now`.
 */
export function getSessionDuration(
  session: Pick<Session, "createdAt" | "startedAt" | "endedAt">,
  now: number = Date.now(),
): number {
  const start = session.startedAt ?? session.createdAt;
  const end = session.endedAt ?? now;

  return Math.max(0, end - start);
}

/**
 * Format duration as human-readable string (e.g., "2m 30s" or "45s").
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}
