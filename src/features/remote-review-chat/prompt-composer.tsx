import {
  ArrowPathIcon,
  ArrowUpIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/20/solid";
import { useState, type FormEvent } from "react";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
} from "../../components/ai-elements/chat";
import {
  getSelectionAttachmentSubtitle,
  type RemoteReviewLineSelection,
} from "./line-selection";
import {
  isRevisionRefreshBlockingPrompt,
  type RevisionRefreshGateState,
} from "./revision-refresh-gate-store";

type PromptComposerProps = {
  canSend: boolean;
  isChatBusy: boolean;
  hasSession: boolean;
  revisionRefreshGate: Pick<
    RevisionRefreshGateState,
    "error" | "mode" | "revision"
  >;
  selectedLineContext: RemoteReviewLineSelection | null;
  onClearSelectedLineContext(): void;
  onRefreshRevision(): void;
  onSend(text: string): void;
  onStop(): void;
};

function PromptComposer({
  canSend,
  hasSession,
  isChatBusy,
  revisionRefreshGate,
  selectedLineContext,
  onClearSelectedLineContext,
  onRefreshRevision,
  onSend,
  onStop,
}: PromptComposerProps) {
  const [prompt, setPrompt] = useState("");
  const isRevisionRefreshBlocking = isRevisionRefreshBlockingPrompt(
    revisionRefreshGate.mode,
  );
  const canSubmitPrompt = canSend && !isRevisionRefreshBlocking;
  const isRefreshButtonDisabled =
    isChatBusy || revisionRefreshGate.mode === "refreshing";
  const shortLatestHeadSha =
    revisionRefreshGate.revision?.latestHeadSha.slice(0, 7) ?? null;

  function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || !canSubmitPrompt) return;
    setPrompt("");
    onSend(text);
  }

  return (
    <PromptInput onSubmit={submitPrompt}>
      {selectedLineContext ? (
        <PromptInputHeader>
          <Attachments>
            <Attachment>
              <AttachmentPreview />
              <AttachmentInfo
                subtitle={getSelectionAttachmentSubtitle(selectedLineContext)}
                title={selectedLineContext.path}
              />
              <AttachmentRemove
                aria-label="Clear selected diff lines"
                onClick={onClearSelectedLineContext}
                title="Clear selected diff lines"
              />
            </Attachment>
          </Attachments>
        </PromptInputHeader>
      ) : null}

      <PromptInputBody>
        {isRevisionRefreshBlocking ? (
          <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
            <div className="flex items-start gap-2">
              <ExclamationTriangleIcon
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-amber-600"
              />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  PR has new changes
                  {shortLatestHeadSha ? ` at ${shortLatestHeadSha}` : ""}
                </p>
                {revisionRefreshGate.mode === "refresh_failed" &&
                revisionRefreshGate.error ? (
                  <p className="mt-1 leading-5 text-amber-800">
                    {revisionRefreshGate.error}
                  </p>
                ) : null}
              </div>
              <button
                className="inline-flex h-7 shrink-0 items-center rounded-md bg-amber-500 px-2.5 text-[11px] font-medium text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isRefreshButtonDisabled}
                onClick={onRefreshRevision}
                type="button"
              >
                {revisionRefreshGate.mode === "refreshing"
                  ? "Refreshing"
                  : isChatBusy
                    ? "Stop Pi first"
                    : "Refresh PR"}
              </button>
            </div>
          </div>
        ) : null}
        <PromptInputTextarea
          disabled={!canSubmitPrompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={
            hasSession
              ? selectedLineContext
                ? "Ask about the selected diff lines..."
                : "Ask about this pull request..."
              : "Select a pull request to start AI chat"
          }
          value={prompt}
        />
        <PromptInputFooter>
          {isChatBusy ? (
            <button
              className="inline-flex h-8 items-center rounded-md border border-ink-200 px-3 text-xs font-medium text-ink-600 transition hover:bg-ink-50 hover:text-ink-900"
              onClick={onStop}
              type="button"
            >
              Stop
            </button>
          ) : null}
          <PromptInputSubmit
            aria-label={isChatBusy ? "Streaming" : "Send"}
            className="w-8 justify-center px-0 rounded-full"
            disabled={!canSubmitPrompt || !prompt.trim()}
          >
            {isChatBusy ? (
              <ArrowPathIcon
                aria-hidden="true"
                className="size-4 animate-spin"
              />
            ) : (
              <ArrowUpIcon aria-hidden="true" className="size-4" />
            )}
          </PromptInputSubmit>
        </PromptInputFooter>
      </PromptInputBody>
    </PromptInput>
  );
}

export { PromptComposer };
