import {
  AuthStorage,
  ModelRegistry,
  createAgentSession,
} from "@mariozechner/pi-coding-agent";
import type { TranscriptMessage } from "../../domain/transcript.js";
import type { PiSessionRuntime, SessionId } from "./types.js";

interface StartPiSessionInput {
  sessionId: SessionId;
  cwd?: string;
  prompt?: string;
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

  async start(input: StartPiSessionInput): Promise<{
    runtime: PiSessionRuntime;
    startedBusy: boolean;
  }> {
    const cwd = input.cwd ?? process.cwd();
    const authStorage = this.options.authStorage ?? AuthStorage.create();
    const modelRegistry =
      this.options.modelRegistry ?? new ModelRegistry(authStorage);

    const { session } = await createAgentSession({
      sessionManager: (
        await import("@mariozechner/pi-coding-agent")
      ).SessionManager.inMemory(cwd),
      authStorage,
      modelRegistry,
      cwd,
    });

    let currentAssistantMessageId: string | null = null;
    let currentAssistantMessageText = "";
    let currentToolBurstId: string | null = null;
    let runtime: PiSessionRuntime | null = null;

    const unsubscribe = session.subscribe((event) => {
      switch (event.type) {
        case "agent_start": {
          if (!runtime) break;
          runtime.isBusy = true;
          this.options.onBusyStateChange(input.sessionId, true);
          break;
        }
        case "message_update": {
          const evt = event.assistantMessageEvent;
          if (evt.type !== "text_delta" && evt.type !== "thinking_delta") {
            break;
          }

          const text = evt.delta ?? "";
          if (!text) break;

          if (currentToolBurstId != null) {
            currentToolBurstId = null;
          }

          if (currentAssistantMessageId == null) {
            currentAssistantMessageId = this.options.generateId();
            currentAssistantMessageText = text;
            this.options.onTranscriptAppend(input.sessionId, {
              id: currentAssistantMessageId,
              role: "assistant",
              text: currentAssistantMessageText,
              timestamp: this.options.now(),
            });
            break;
          }

          currentAssistantMessageText += text;
          this.options.onTranscriptUpdate(input.sessionId, {
            id: currentAssistantMessageId,
            role: "assistant",
            text: currentAssistantMessageText,
            timestamp: this.options.now(),
          });
          break;
        }
        case "message_end": {
          currentAssistantMessageId = null;
          currentAssistantMessageText = "";
          break;
        }
        case "tool_execution_start": {
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
          break;
        }
        case "agent_end": {
          if (!runtime) break;
          runtime.isBusy = false;
          this.options.onBusyStateChange(input.sessionId, false);
          break;
        }
      }
    });

    const startedBusy = Boolean(input.prompt?.trim());

    runtime = {
      agentSession: session,
      abortController: new AbortController(),
      unsubscribe,
      isBusy: startedBusy,
    };

    return { runtime, startedBusy };
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
