import { ArrowPathIcon, ArrowUpIcon } from "@heroicons/react/20/solid";
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

type PromptComposerProps = {
  canSend: boolean;
  isChatBusy: boolean;
  hasSession: boolean;
  selectedLineContext: RemoteReviewLineSelection | null;
  onClearSelectedLineContext(): void;
  onSend(text: string): void;
  onStop(): void;
};

function PromptComposer({
  canSend,
  hasSession,
  isChatBusy,
  selectedLineContext,
  onClearSelectedLineContext,
  onSend,
  onStop,
}: PromptComposerProps) {
  const [prompt, setPrompt] = useState("");

  function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || !canSend) return;
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
        <PromptInputTextarea
          disabled={!canSend}
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
            disabled={!canSend || !prompt.trim()}
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
