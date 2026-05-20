import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import {
  cancelReviewChatTurn,
  ensureReviewChatSession,
  listenReviewChatEvents,
  sendReviewChatMessage,
} from "../../queries/review-session-native";
import type {
  ReviewChatAcpPlanEntry,
  ReviewChatEvent,
  ReviewChatToolEvent,
} from "../../types/github";
import {
  buildPromptWithAttachments,
  normalizeAttachmentsFromMetadata,
  type ReviewChatMessageMetadata,
} from "./line-selection";

type ReviewChatAcpPlan = {
  entries: ReviewChatAcpPlanEntry[];
};

type ReviewChatAcpDebug = {
  stage: string;
  sessionId: string;
  turnId: string;
  timestamp: number;
  promptLength?: number;
  attachmentCount?: number;
  inlineAttachmentCount?: number;
  error?: string;
};

type ReviewChatDataParts = {
  "acp-debug": ReviewChatAcpDebug;
  "acp-plan": ReviewChatAcpPlan;
};

type ReviewChatMessage = UIMessage<
  ReviewChatMessageMetadata,
  ReviewChatDataParts
>;

type ReviewChatChunkMapper = {
  mapEvent(event: ReviewChatEvent): UIMessageChunk[];
  abort(reason?: string): UIMessageChunk[];
};

type ToolPartState = {
  inputAvailable: boolean;
  outputAvailable: boolean;
  title: string;
  toolName: string;
};

function createTurnId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "");
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function extractLastUserText(messages: ReviewChatMessage[]) {
  const lastUserMessage = getLastUserMessage(messages);

  const text =
    lastUserMessage?.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("")
      .trim() ?? "";

  return buildPromptWithAttachments(
    text,
    normalizeAttachmentsFromMetadata(lastUserMessage?.metadata),
  );
}

function getLastUserMessage(messages: ReviewChatMessage[]) {
  return [...messages].reverse().find((message) => message.role === "user");
}

function debugChunk(
  data: Omit<ReviewChatAcpDebug, "timestamp">,
): UIMessageChunk {
  return {
    type: "data-acp-debug",
    id: `debug-${data.turnId}-${data.stage}`,
    data: {
      ...data,
      timestamp: Date.now(),
    },
  };
}

function sanitizeToolName(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "acp_tool";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInternalToolTitle(title: string | null, toolCallId: string) {
  if (!title) return true;
  const trimmed = title.trim();
  if (!trimmed) return true;
  if (trimmed === toolCallId) return true;
  if (trimmed.includes("|fc_")) return true;
  return /^call_[A-Za-z0-9_-]+$/.test(trimmed);
}

function inferToolTitleFromInput(input: unknown) {
  if (!isPlainObject(input)) return null;

  if (typeof input.body === "string") {
    return "Tool call";
  }

  if (typeof input.path === "string") {
    if (typeof input.startLine === "number" || typeof input.endLine === "number") {
      return `Read ${input.path}`;
    }
    return `Inspect ${input.path}`;
  }

  return null;
}

function displayTitleForTool(event: ReviewChatToolEvent) {
  if (!isInternalToolTitle(event.title, event.toolCallId)) {
    return event.title?.trim() ?? "Tool call";
  }

  return inferToolTitleFromInput(event.rawInput) ?? "Tool call";
}

function outputForTool(event: ReviewChatToolEvent) {
  return (
    event.rawOutput ?? {
      status: event.status ?? "completed",
      title: displayTitleForTool(event),
    }
  );
}

function finishReasonForStopReason(
  stopReason: string | null,
): Extract<UIMessageChunk, { type: "finish" }>["finishReason"] {
  switch (stopReason) {
    case "max_tokens":
    case "max_output_tokens":
      return "length";
    case "error":
      return "error";
    case "end_turn":
    case "stop":
      return "stop";
    default:
      return "other";
  }
}

function createReviewChatChunkMapper(
  turnId: string,
): ReviewChatChunkMapper {
  const reasoningId = `${turnId}-reasoning`;
  const tools = new Map<string, ToolPartState>();
  let textPartIndex = 0;
  let activeTextId: string | null = null;
  let textOpen = false;
  let reasoningOpen = false;
  let closed = false;

  function nextTextId() {
    textPartIndex += 1;
    return `${turnId}-text-${textPartIndex}`;
  }

  function startTextIfNeeded(chunks: UIMessageChunk[]) {
    if (textOpen && activeTextId) return activeTextId;
    activeTextId = nextTextId();
    textOpen = true;
    chunks.push({ type: "text-start", id: activeTextId });
    return activeTextId;
  }

  function startReasoningIfNeeded(chunks: UIMessageChunk[]) {
    if (reasoningOpen) return;
    reasoningOpen = true;
    chunks.push({ type: "reasoning-start", id: reasoningId });
  }

  function closeOpenText(chunks: UIMessageChunk[]) {
    if (!textOpen || !activeTextId) return;
    chunks.push({ type: "text-end", id: activeTextId });
    textOpen = false;
    activeTextId = null;
  }

  function closeOpenParts(chunks: UIMessageChunk[]) {
    if (reasoningOpen) {
      chunks.push({ type: "reasoning-end", id: reasoningId });
      reasoningOpen = false;
    }
    closeOpenText(chunks);
  }

  function ensureToolInput(
    chunks: UIMessageChunk[],
    event: ReviewChatToolEvent,
  ) {
    const title = displayTitleForTool(event);
    const existing = tools.get(event.toolCallId);
    const toolName = existing?.toolName ?? sanitizeToolName(title);

    if (!existing) {
      chunks.push({
        type: "tool-input-start",
        toolCallId: event.toolCallId,
        toolName,
        dynamic: true,
        title,
      });
      tools.set(event.toolCallId, {
        inputAvailable: false,
        outputAvailable: false,
        title,
        toolName,
      });
    }

    const next = tools.get(event.toolCallId);
    if (!next?.inputAvailable || event.rawInput !== null) {
      chunks.push({
        type: "tool-input-available",
        toolCallId: event.toolCallId,
        toolName,
        input: event.rawInput ?? {},
        dynamic: true,
        title,
      });
      tools.set(event.toolCallId, {
        inputAvailable: true,
        outputAvailable: next?.outputAvailable ?? false,
        title,
        toolName,
      });
    }
  }

  function mapEvent(event: ReviewChatEvent): UIMessageChunk[] {
    if (closed) return [];

    const chunks: UIMessageChunk[] = [];

    if (event.kind === "message") {
      const textId = startTextIfNeeded(chunks);
      chunks.push({ type: "text-delta", id: textId, delta: event.text });
      return chunks;
    }

    if (event.kind === "thought") {
      closeOpenText(chunks);
      startReasoningIfNeeded(chunks);
      chunks.push({
        type: "reasoning-delta",
        id: reasoningId,
        delta: event.text,
      });
      return chunks;
    }

    if (event.kind === "plan") {
      closeOpenText(chunks);
      chunks.push({
        type: "data-acp-plan",
        id: "plan",
        data: { entries: event.entries },
      });
      return chunks;
    }

    if (event.kind === "tool") {
      closeOpenText(chunks);
      ensureToolInput(chunks, event);
      const tool = tools.get(event.toolCallId);

      if (event.status === "completed" && !tool?.outputAvailable) {
        chunks.push({
          type: "tool-output-available",
          toolCallId: event.toolCallId,
          output: outputForTool(event),
          dynamic: true,
        });
        if (tool) {
          tools.set(event.toolCallId, { ...tool, outputAvailable: true });
        }
      }

      if (event.status === "failed" && !tool?.outputAvailable) {
        chunks.push({
          type: "tool-output-error",
          toolCallId: event.toolCallId,
          errorText:
            typeof event.rawOutput === "string"
              ? event.rawOutput
              : `${displayTitleForTool(event)} failed`,
          dynamic: true,
        });
        if (tool) {
          tools.set(event.toolCallId, { ...tool, outputAvailable: true });
        }
      }

      return chunks;
    }

    if (event.kind === "finished") {
      closeOpenParts(chunks);
      chunks.push({
        type: "finish",
        finishReason: finishReasonForStopReason(event.stopReason),
        messageMetadata: {
          acpStopReason: event.stopReason,
          finishedAt: Date.now(),
          turnId,
        },
      });
      closed = true;
      return chunks;
    }

    closeOpenParts(chunks);
    chunks.push({ type: "error", errorText: event.message });
    closed = true;
    return chunks;
  }

  function abort(reason = "aborted"): UIMessageChunk[] {
    if (closed) return [];
    const chunks: UIMessageChunk[] = [];
    closeOpenParts(chunks);
    chunks.push({ type: "abort", reason });
    closed = true;
    return chunks;
  }

  return {
    abort,
    mapEvent(event) {
      if (event.turnId !== turnId) return [];
      return mapEvent(event);
    },
  };
}

type TauriAcpChatTransportOptions = {
  sessionId: string | null;
};

class TauriAcpChatTransport
  implements ChatTransport<ReviewChatMessage>
{
  readonly #sessionId: string | null;

  constructor({ sessionId }: TauriAcpChatTransportOptions) {
    this.#sessionId = sessionId;
  }

  async sendMessages({
    abortSignal,
    messages,
  }: Parameters<ChatTransport<ReviewChatMessage>["sendMessages"]>[0]) {
    const sessionId = this.#sessionId;
    if (!sessionId) {
      throw new Error("Select a pull request to chat with Rudu.");
    }
    const activeSessionId = sessionId;

    const lastUserMessage = getLastUserMessage(messages);
    const attachmentCount =
      normalizeAttachmentsFromMetadata(lastUserMessage?.metadata).length;
    const inlineAttachmentCount =
      lastUserMessage?.metadata?.inlineAttachments?.length ?? 0;
    const text = extractLastUserText(messages);
    if (!text) {
      throw new Error("Enter a message for Rudu.");
    }

    const turnId = createTurnId();
    const mapper = createReviewChatChunkMapper(turnId);

    return new ReadableStream<UIMessageChunk>({
      start(controller) {
        let didSettle = false;
        let unlisten: (() => void) | null = null;

        function cleanup() {
          abortSignal?.removeEventListener("abort", handleAbort);
          unlisten?.();
          unlisten = null;
        }

        function enqueue(chunks: UIMessageChunk[]) {
          if (didSettle) return;
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
        }

        function settle() {
          didSettle = true;
          cleanup();
          controller.close();
        }

        function fail(error: unknown) {
          if (didSettle) return;
          const message =
            error instanceof Error
              ? error.message
              : typeof error === "string" && error.trim()
                ? error
                : "Rudu chat failed.";
          enqueue(
            mapper.mapEvent({
              kind: "error",
              sessionId: activeSessionId,
              turnId,
              message,
            }),
          );
          settle();
        }

        function handleAbort() {
          if (didSettle) return;
          void cancelReviewChatTurn(activeSessionId, turnId);
          enqueue(mapper.abort("aborted"));
          settle();
        }

        abortSignal?.addEventListener("abort", handleAbort);
        const startedAt = Date.now();
        controller.enqueue({
          type: "start",
          messageId: `assistant-${turnId}`,
          messageMetadata: { startedAt, turnId },
        });
        controller.enqueue(
          debugChunk({
            attachmentCount,
            inlineAttachmentCount,
            promptLength: text.length,
            sessionId: activeSessionId,
            stage: "stream_started",
            turnId,
          }),
        );

        void listenReviewChatEvents((event) => {
          if (didSettle) {
            return;
          }
          if (event.sessionId !== activeSessionId || event.turnId !== turnId) {
            return;
          }

          const chunks = mapper.mapEvent(event);
          enqueue(chunks);

          if (event.kind === "finished" || event.kind === "error") {
            settle();
          }
        })
          .then(async (nextUnlisten) => {
            if (didSettle) {
              nextUnlisten();
              return;
            }

            unlisten = nextUnlisten;
            enqueue(
              debugChunk({
                attachmentCount,
                inlineAttachmentCount,
                promptLength: text.length,
                sessionId: activeSessionId,
                stage: "listener_ready",
                turnId,
              }),
            );
            await ensureReviewChatSession(activeSessionId);

            if (didSettle) return;
            enqueue(
              debugChunk({
                attachmentCount,
                inlineAttachmentCount,
                promptLength: text.length,
                sessionId: activeSessionId,
                stage: "session_ready",
                turnId,
              }),
            );
            enqueue(
              debugChunk({
                attachmentCount,
                inlineAttachmentCount,
                promptLength: text.length,
                sessionId: activeSessionId,
                stage: "prompt_send_requested",
                turnId,
              }),
            );
            await sendReviewChatMessage(activeSessionId, turnId, text);
            enqueue(
              debugChunk({
                attachmentCount,
                inlineAttachmentCount,
                promptLength: text.length,
                sessionId: activeSessionId,
                stage: "prompt_sent",
                turnId,
              }),
            );
          })
          .catch(fail);
      },
    });
  }

  async reconnectToStream() {
    return null;
  }
}

export {
  createReviewChatChunkMapper,
  extractLastUserText,
  TauriAcpChatTransport,
};
export type { ReviewChatAcpDebug, ReviewChatAcpPlan, ReviewChatMessage };
