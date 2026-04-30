import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

type CodexAcpEvent = {
  kind: string;
  localSessionId: string;
  promptId: string | null;
  permissionRequestId: string | null;
  message: string | null;
  raw: unknown | null;
};

type CodexStartSessionResponse = {
  localSessionId: string;
};

type CodexSessionContext = {
  selectedPrKey: string | null;
  selectedDiffKey: string | null;
  repo: string | null;
  pullRequestNumber: number | null;
  pullRequestTitle: string | null;
  pullRequestUrl: string | null;
  headSha: string | null;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
};

function createLocalId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type CodexChatPanelProps = {
  context: CodexSessionContext;
};

function CodexChatPanel({ context }: CodexChatPanelProps) {
  const [localSessionId, setLocalSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState("Not started");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const activeAssistantIdRef = useRef<string | null>(null);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let didCancel = false;

    void listen<CodexAcpEvent>("codex-acp-event", (event) => {
      if (didCancel) return;
      const payload = event.payload;
      setLocalSessionId(payload.localSessionId);

      if (payload.kind !== "sessionUpdate") {
        setStatus(payload.message ? `${payload.kind}: ${payload.message}` : payload.kind);
      }

      if (payload.kind === "sessionStarted") {
        setIsStopping(false);
        setStatus("Session ready");
        return;
      }

      if (payload.kind === "stopped") {
        setLocalSessionId(null);
        setIsSending(false);
        setIsStopping(false);
        activeAssistantIdRef.current = null;
        return;
      }

      if (payload.kind === "promptStarted") {
        setIsSending(true);
        const assistantId = createLocalId("assistant");
        activeAssistantIdRef.current = assistantId;
        setMessages((current) => [
          ...current,
          { id: assistantId, role: "assistant", content: "" },
        ]);
        return;
      }

      if (payload.kind === "promptDone") {
        setIsSending(false);
        activeAssistantIdRef.current = null;
        setStatus("Turn complete");
        return;
      }

      if (payload.kind === "error") {
        setIsSending(false);
        activeAssistantIdRef.current = null;
        setMessages((current) => [
          ...current,
          {
            id: createLocalId("error"),
            role: "system",
            content: payload.message ?? "Codex ACP error",
          },
        ]);
        return;
      }

      if (payload.kind === "permissionRequested") {
        setMessages((current) => [
          ...current,
          {
            id: createLocalId("permission"),
            role: "system",
            content:
              payload.message ??
              "Codex requested permission, but this chat is analysis-only so the request was denied.",
          },
        ]);
        return;
      }

      if (payload.kind === "sessionUpdate" && payload.message) {
        const assistantId = activeAssistantIdRef.current;
        if (!assistantId) {
          setMessages((current) => [
            ...current,
            {
              id: createLocalId("assistant"),
              role: "assistant",
              content: payload.message ?? "",
            },
          ]);
          return;
        }

        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? { ...message, content: `${message.content}${payload.message}` }
              : message,
          ),
        );
      }
    }).then((nextUnlisten) => {
      if (didCancel) {
        nextUnlisten();
        return;
      }
      unlisten = nextUnlisten;
    });

    return () => {
      didCancel = true;
      unlisten?.();
    };
  }, []);

  async function startSession() {
    setIsStarting(true);
    try {
      const response = await invoke<CodexStartSessionResponse>(
        "codex_acp_start_session",
        { context },
      );
      setLocalSessionId(response.localSessionId);
      setStatus("Starting session...");
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setIsStopping(false);
      return false;
    } finally {
      setIsStarting(false);
    }
  }

  async function stopSession() {
    setIsStopping(true);
    setStatus("Stopping session...");
    try {
      await invoke("codex_acp_stop_session");
    } catch (error) {
      setIsStopping(false);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function sendPrompt() {
    const text = input.trim();
    if (!text || isSending || isStopping) return;
    if (!localSessionId) {
      const didStart = await startSession();
      if (!didStart) return;
    }

    setInput("");
    setMessages((current) => [
      ...current,
      { id: createLocalId("user"), role: "user", content: text },
    ]);

    try {
      setIsSending(true);
      await invoke<string>("codex_acp_send_prompt", { context, text });
    } catch (error) {
      setIsSending(false);
      setMessages((current) => [
        ...current,
        {
          id: createLocalId("error"),
          role: "system",
          content: error instanceof Error ? error.message : String(error),
        },
      ]);
    }
  }

  return (
    <aside className="flex h-full min-h-0 w-[360px] shrink-0 flex-col border-l border-ink-200 bg-surface">
      <div className="flex items-center gap-2 border-b border-ink-200 px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-ink-900">Codex</h2>
          <p className="truncate text-xs text-ink-500">{status}</p>
        </div>
        <button
          className="rounded-md border border-ink-200 px-2 py-1 text-xs font-medium text-ink-700 transition hover:bg-canvasDark disabled:cursor-default disabled:opacity-60"
          disabled={isStarting || isStopping || Boolean(localSessionId)}
          onClick={() => void startSession()}
          type="button"
        >
          {isStarting ? "Starting" : "Start"}
        </button>
        <button
          className="rounded-md border border-ink-200 px-2 py-1 text-xs font-medium text-ink-600 transition hover:bg-canvasDark disabled:cursor-default disabled:opacity-60"
          disabled={!localSessionId || isStopping}
          onClick={() => void stopSession()}
          type="button"
        >
          {isStopping ? "Stopping" : "Stop"}
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <div className="rounded-lg border border-dashed border-ink-200 bg-canvas px-3 py-4 text-sm text-ink-500">
            Start a Codex ACP session and send a prompt. This is a transport
            smoke test, not the final chat UI.
          </div>
        ) : null}
        {messages.map((message) => (
          <div
            className={[
              "rounded-lg px-3 py-2 text-sm leading-6",
              message.role === "user"
                ? "ml-8 bg-ink-900 text-white dark:bg-ink-200 dark:text-ink-900"
                : message.role === "system"
                  ? "border border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
                  : "mr-8 border border-ink-200 bg-canvas text-ink-800",
            ].join(" ")}
            key={message.id}
          >
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide opacity-60">
              {message.role}
            </div>
            <div className="whitespace-pre-wrap break-words">
              {message.content || (message.role === "assistant" ? "Thinking..." : "")}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-ink-200 p-3">
        <textarea
          className="min-h-[84px] w-full resize-none rounded-lg border border-ink-200 bg-canvas px-3 py-2 text-sm text-ink-900 outline-none transition placeholder:text-ink-400 focus:border-ink-400 disabled:cursor-default disabled:opacity-60"
          disabled={isSending || isStopping}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void sendPrompt();
            }
          }}
          placeholder="Ask Codex..."
          value={input}
        />
        <button
          className="mt-2 w-full rounded-md bg-ink-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-ink-700 disabled:cursor-default disabled:opacity-60 dark:bg-ink-200 dark:text-ink-900 dark:hover:bg-ink-300"
          disabled={isSending || isStopping || !input.trim()}
          onClick={() => void sendPrompt()}
          type="button"
        >
          {isStopping ? "Stopping..." : isSending ? "Waiting for Codex..." : "Send"}
        </button>
      </div>
    </aside>
  );
}

export { CodexChatPanel };
