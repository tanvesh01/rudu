import {
  AuthStorage,
  ModelRegistry,
  SessionManager as PiSdkSessionManager,
  createAgentSession,
} from "@mariozechner/pi-coding-agent";
import type { TranscriptMessage } from "../../domain/transcript.js";
import type { PiSessionRuntime, SessionId } from "./types.js";

interface StartPiSessionInput {
  sessionId: SessionId;
  cwd?: string;
  prompt?: string;
  sessionFile?: string;
}

interface LoadHistoryInput {
  cwd?: string;
  sessionFile: string;
}

interface PiSessionRunnerOptions {
  now: () => number;
  generateId: () => string;
  authStorage?: AuthStorage;
  modelRegistry?: ModelRegistry;
  onBusyStateChange: (sessionId: SessionId, isBusy: boolean) => void;
  onTranscriptAppend: (
    sessionId: SessionId,
    message: TranscriptMessage,
  ) => void;
  onTranscriptUpdate: (
    sessionId: SessionId,
    message: TranscriptMessage,
  ) => void;
  onFatalError: (sessionId: SessionId, error: string) => void;
}

export class PiSessionRunner {
  constructor(private options: PiSessionRunnerOptions) {}

  async loadHistory(input: LoadHistoryInput): Promise<TranscriptMessage[]> {
    const sessionManager = PiSdkSessionManager.open(input.sessionFile);
    const entries = sessionManager.getEntries() as Array<{
      type?: string;
      id?: string;
      timestamp?: string;
      message?: unknown;
      summary?: string;
    }>;
    const history: TranscriptMessage[] = [];

    for (const entry of entries) {
      if (entry.type === "message" && entry.message) {
        const message = this.parseMessage(entry.message);
        if (!message) continue;
        history.push(message);
        continue;
      }

      if (entry.type === "branch_summary" || entry.type === "compaction") {
        if (!entry.summary?.trim()) continue;
        history.push({
          id: entry.id ?? this.options.generateId(),
          role: "system",
          text: entry.summary,
          timestamp: this.parseTimestamp(entry.timestamp),
        });
      }
    }

    return history;
  }

  async start(input: StartPiSessionInput): Promise<{
    runtime: PiSessionRuntime;
    persistedSessionId: string;
    persistedSessionFile?: string;
    history: TranscriptMessage[];
  }> {
    const cwd = input.cwd ?? process.cwd();
    const authStorage = this.options.authStorage ?? AuthStorage.create();
    const modelRegistry =
      this.options.modelRegistry ?? new ModelRegistry(authStorage);

    const sessionManager = input.sessionFile
      ? PiSdkSessionManager.open(input.sessionFile)
      : PiSdkSessionManager.create(cwd);

    const { session } = await createAgentSession({
      sessionManager,
      authStorage,
      modelRegistry,
      cwd,
    });

    const history = this.buildTranscriptHistory(session.messages as unknown[]);

    let currentAssistantMessageId: string | null = null;
    let currentAssistantMessageText = "";
    let currentToolBurstId: string | null = null;
    let runtime: PiSessionRuntime | null = null;

    const unsubscribe = session.subscribe((event) => {
      console.log("SDK event received:", event.type);
      switch (event.type) {
        case "agent_start": {
          console.log("agent_start event");
          this.options.onBusyStateChange(input.sessionId, true);
          break;
        }
        case "message_update": {
          console.log("message_update event:", event.assistantMessageEvent.type);
          const evt = event.assistantMessageEvent;
          if (evt.type !== "text_delta" && evt.type !== "thinking_delta") {
            break;
          }

          const text = evt.delta ?? "";
          console.log("text delta:", text.substring(0, 50));
          if (!text) break;

          if (currentToolBurstId != null) {
            currentToolBurstId = null;
          }

          if (currentAssistantMessageId == null) {
            currentAssistantMessageId = this.options.generateId();
            currentAssistantMessageText = text;
            console.log("Appending new assistant message:", text.substring(0, 50));
            this.options.onTranscriptAppend(input.sessionId, {
              id: currentAssistantMessageId,
              role: "assistant",
              text: currentAssistantMessageText,
              timestamp: this.options.now(),
            });
            break;
          }

          currentAssistantMessageText += text;
          console.log("Updating assistant message, new length:", currentAssistantMessageText.length);
          this.options.onTranscriptUpdate(input.sessionId, {
            id: currentAssistantMessageId,
            role: "assistant",
            text: currentAssistantMessageText,
            timestamp: this.options.now(),
          });
          break;
        }
        case "message_end": {
          console.log("message_end event");
          currentAssistantMessageId = null;
          currentAssistantMessageText = "";
          break;
        }
        case "tool_execution_start": {
          console.log("tool_execution_start:", event.toolName);
          if (currentToolBurstId == null) {
            currentToolBurstId = this.options.generateId();
            this.options.onTranscriptAppend(input.sessionId, {
              id: currentToolBurstId,
              role: "tool",
              text: event.toolName,
              timestamp: this.options.now(),
            });
            break;
          }

          this.options.onTranscriptUpdate(input.sessionId, {
            id: currentToolBurstId,
            role: "tool",
            text: event.toolName,
            timestamp: this.options.now(),
          });
          break;
        }
        case "tool_execution_end": {
          console.log("tool_execution_end");
          break;
        }
        case "agent_end": {
          console.log("agent_end event");
          this.options.onBusyStateChange(input.sessionId, false);
          break;
        }
      }
    });

    runtime = {
      agentSession: session,
      abortController: new AbortController(),
      unsubscribe,
    };

    return {
      runtime,
      persistedSessionId: session.sessionId,
      persistedSessionFile: session.sessionFile,
      history,
    };
  }

  private buildTranscriptHistory(messages: readonly unknown[]): TranscriptMessage[] {
    const history: TranscriptMessage[] = [];

    for (const message of messages) {
      const parsed = this.parseMessage(message);
      if (!parsed) continue;
      history.push(parsed);
    }

    return history;
  }

  private parseMessage(message: unknown): TranscriptMessage | undefined {
    if (!message || typeof message !== "object") return undefined;
    const entry = message as Record<string, unknown>;
    const role = typeof entry.role === "string" ? entry.role : undefined;
    if (!role) return undefined;

    let transcriptRole: TranscriptMessage["role"];
    switch (role) {
      case "user":
        transcriptRole = "user";
        break;
      case "assistant":
        transcriptRole = "assistant";
        break;
      case "tool":
      case "bashExecution":
        transcriptRole = "tool";
        break;
      case "custom":
      case "branchSummary":
      case "compactionSummary":
        transcriptRole = "system";
        break;
      default:
        return undefined;
    }

    const text = this.extractMessageText(entry);
    if (!text.trim()) return undefined;

    const timestamp = this.parseTimestamp(entry.timestamp);

    return {
      id: typeof entry.id === "string" ? entry.id : this.options.generateId(),
      role: transcriptRole,
      text,
      timestamp,
    };
  }

  private parseTimestamp(raw: unknown): number {
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string") {
      const asNumber = Number(raw);
      if (Number.isFinite(asNumber)) return asNumber;
      const parsed = Date.parse(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
    return this.options.now();
  }

  private extractMessageText(entry: Record<string, unknown>): string {
    if (typeof entry.text === "string") return entry.text;
    if (typeof entry.output === "string") return entry.output;
    if (typeof entry.summary === "string") return entry.summary;
    if (typeof entry.command === "string") return entry.command;

    const content = entry.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const pieces: string[] = [];
      for (const item of content) {
        if (typeof item === "string") {
          pieces.push(item);
          continue;
        }
        if (!item || typeof item !== "object") continue;
        const part = item as Record<string, unknown>;
        if (typeof part.text === "string") pieces.push(part.text);
      }
      return pieces.join("\n");
    }

    return "";
  }

  startPrompt(
    sessionId: SessionId,
    runtime: PiSessionRuntime,
    prompt: string,
  ): void {
    void runtime.agentSession.prompt(prompt).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.options.onFatalError(sessionId, message);
    });
  }
}
