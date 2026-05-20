import {
  ArrowUpIcon,
  CodeBracketIcon,
  ExclamationTriangleIcon,
  StopIcon,
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
} from "../../components/ai-elements/chat";
import type { IssueSummary } from "../../types/issues";
import {
  addReviewChatAttachment,
  getReviewChatAttachmentKey,
  getReviewChatAttachmentSubtitle,
  getReviewChatAttachmentTitle,
  trimInlineAttachmentRanges,
  type ReviewChatAttachment,
  type ReviewChatInlineAttachmentRange,
} from "./line-selection";
import {
  isRevisionRefreshBlockingPrompt,
  type RevisionRefreshGateState,
} from "./revision-refresh-gate-store";
import {
  ReviewChatPromptEditor,
  type ReviewChatPromptDraft,
} from "./review-chat-prompt-editor";

type PromptComposerProps = {
  attachments: ReviewChatAttachment[];
  canSend: boolean;
  currentRepo: string | null;
  isChatBusy: boolean;
  hasSession: boolean;
  knownIssues: IssueSummary[];
  revisionRefreshGate: Pick<
    RevisionRefreshGateState,
    "error" | "mode" | "revision"
  >;
  sessionHeadSha: string | null;
  sessionId: string | null;
  workspaceFiles: string[];
  onRemoveAttachment(attachmentId: string): void;
  onRefreshRevision(): void;
  onSend(
    text: string,
    attachments: ReviewChatAttachment[],
    inlineAttachments: ReviewChatInlineAttachmentRange[],
  ): void;
  onStop(): void;
};

const EMPTY_PROMPT_DRAFT: ReviewChatPromptDraft = {
  attachments: [],
  inlineAttachments: [],
  text: "",
};

function combineAttachments(
  externalAttachments: ReviewChatAttachment[],
  mentionAttachments: ReviewChatAttachment[],
) {
  return mentionAttachments.reduce(
    (current, attachment) => addReviewChatAttachment(current, attachment),
    externalAttachments,
  );
}

function PromptComposer({
  attachments,
  canSend,
  currentRepo,
  hasSession,
  isChatBusy,
  knownIssues,
  revisionRefreshGate,
  sessionHeadSha,
  sessionId,
  workspaceFiles,
  onRemoveAttachment,
  onRefreshRevision,
  onSend,
  onStop,
}: PromptComposerProps) {
  const [promptDraft, setPromptDraft] =
    useState<ReviewChatPromptDraft>(EMPTY_PROMPT_DRAFT);
  const [clearSignal, setClearSignal] = useState(0);
  const isRevisionRefreshBlocking = isRevisionRefreshBlockingPrompt(
    revisionRefreshGate.mode,
  );
  const canSubmitPrompt = canSend && !isRevisionRefreshBlocking;
  const isRefreshButtonDisabled =
    isChatBusy || revisionRefreshGate.mode === "refreshing";
  const shortLatestHeadSha =
    revisionRefreshGate.revision?.latestHeadSha.slice(0, 7) ?? null;
  const promptText = promptDraft.text.trim();
  const inlineAttachments = trimInlineAttachmentRanges(
    promptDraft.text,
    promptDraft.inlineAttachments,
  );
  const combinedAttachments = combineAttachments(
    attachments,
    promptDraft.attachments,
  );

  function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!promptText || !canSubmitPrompt) return;
    onSend(promptText, combinedAttachments, inlineAttachments);
    setPromptDraft(EMPTY_PROMPT_DRAFT);
    setClearSignal((current) => current + 1);
  }

  return (
    <PromptInput className="px-[1.15rem]" onSubmit={submitPrompt}>
      {attachments.length > 0 ? (
        <PromptInputHeader>
          <Attachments>
            {attachments.map((attachment) => {
              const attachmentId = getReviewChatAttachmentKey(attachment);
              return (
                <Attachment key={attachmentId}>
                  <AttachmentPreview
                    icon={
                      attachment.kind === "diff-lines" ? (
                        <CodeBracketIcon
                          aria-hidden="true"
                          className="size-3.5"
                        />
                      ) : undefined
                    }
                  />
                  <AttachmentInfo
                    subtitle={getReviewChatAttachmentSubtitle(attachment)}
                    title={getReviewChatAttachmentTitle(attachment)}
                  />
                  <AttachmentRemove
                    aria-label={`Remove ${getReviewChatAttachmentTitle(
                      attachment,
                    )}`}
                    onClick={() => onRemoveAttachment(attachmentId)}
                    title={`Remove ${getReviewChatAttachmentTitle(attachment)}`}
                  />
                </Attachment>
              );
            })}
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
                    ? "Stop Rudu first"
                    : "Refresh PR"}
              </button>
            </div>
          </div>
        ) : null}
        <ReviewChatPromptEditor
          clearSignal={clearSignal}
          currentRepo={currentRepo}
          disabled={!canSubmitPrompt}
          knownIssues={knownIssues}
          onChange={setPromptDraft}
          placeholder={
            hasSession
              ? combinedAttachments.length > 0
                ? "Ask with attached context..."
                : "Ask about this pull request..."
              : "Select a pull request to chat with Rudu"
          }
          sessionHeadSha={sessionHeadSha}
          sessionId={sessionId}
          workspaceFiles={workspaceFiles}
        />
        <PromptInputFooter>
          <PromptInputSubmit
            aria-label={isChatBusy ? "Stop" : "Send"}
            className=" justify-center p-2 rounded-full"
            disabled={isChatBusy ? false : !canSubmitPrompt || !promptText}
            onClick={(event) => {
              if (!isChatBusy) return;
              event.preventDefault();
              onStop();
            }}
          >
            {isChatBusy ? (
              <StopIcon aria-hidden="true" className="size-4" />
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
