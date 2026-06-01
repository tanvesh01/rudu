import {
  ArrowUpIcon,
  ExclamationTriangleIcon,
  StopIcon,
} from "@heroicons/react/20/solid";
import { useState, type FormEvent } from "react";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
} from "../../../components/ai-elements/chat";
import type {
  PullRequestSummary,
  ReviewChatRuntimeKind,
} from "../../../types/github";
import type { IssueSummary } from "../../../types/issues";
import {
  trimInlineAttachmentRanges,
  type ReviewChatAttachment,
  type ReviewChatInlineAttachmentRange,
} from "../selection/line-selection";
import {
  isRevisionRefreshBlockingPrompt,
  type RevisionRefreshGateState,
} from "../panel/revision-refresh-gate-store";
import {
  ReviewChatPromptEditor,
  type ReviewChatDiffLineAttachmentRequest,
  type ReviewChatPromptDraft,
} from "./editor";
import {
  PromptModeToggle,
  type ReviewChatEffortMode,
} from "./mode-toggle";
import { RuntimeModelSelector } from "./model-selector";
import { ReviewRuntimeSelector } from "../panel/runtime-selector";

type PromptComposerProps = {
  canSend: boolean;
  currentRepo: string | null;
  diffLineAttachmentRequest?: ReviewChatDiffLineAttachmentRequest | null;
  isChatBusy: boolean;
  hasSession: boolean;
  knownIssues: IssueSummary[];
  knownPullRequests: PullRequestSummary[];
  runtimeModelChoice: string | null;
  runtimeModelOptions: string[];
  reviewRuntime: ReviewChatRuntimeKind;
  isLoadingRuntimeModels: boolean;
  pendingReviewEffortMode: ReviewChatEffortMode | null;
  reviewEffortMode: ReviewChatEffortMode;
  revisionRefreshGate: Pick<
    RevisionRefreshGateState,
    "error" | "mode" | "revision"
  >;
  sessionHeadSha: string | null;
  sessionId: string | null;
  workspaceFiles: string[];
  onDiffLineAttachmentRequestHandled(requestId: number): void;
  onDraftAttachmentsChange(attachments: ReviewChatAttachment[]): void;
  onRefreshRevision(): void;
  onReviewEffortModeChange(mode: ReviewChatEffortMode): void;
  onReviewRuntimeChange(runtime: ReviewChatRuntimeKind): void;
  onRuntimeModelChange(model: string): void;
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

function PromptComposer({
  canSend,
  currentRepo,
  diffLineAttachmentRequest,
  hasSession,
  isChatBusy,
  knownIssues,
  knownPullRequests,
  runtimeModelChoice,
  runtimeModelOptions,
  reviewRuntime,
  isLoadingRuntimeModels,
  pendingReviewEffortMode,
  reviewEffortMode,
  revisionRefreshGate,
  sessionHeadSha,
  sessionId,
  workspaceFiles,
  onDiffLineAttachmentRequestHandled,
  onDraftAttachmentsChange,
  onRefreshRevision,
  onReviewEffortModeChange,
  onReviewRuntimeChange,
  onRuntimeModelChange,
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
  const isOpenCodeRuntime = reviewRuntime === "open_code";
  const inlineAttachments = trimInlineAttachmentRanges(
    promptDraft.text,
    promptDraft.inlineAttachments,
  );
  const combinedAttachments = promptDraft.attachments;

  function handlePromptDraftChange(draft: ReviewChatPromptDraft) {
    setPromptDraft(draft);
    onDraftAttachmentsChange(draft.attachments);
  }

  function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!promptText || !canSubmitPrompt) return;
    onSend(promptText, combinedAttachments, inlineAttachments);
    setPromptDraft(EMPTY_PROMPT_DRAFT);
    onDraftAttachmentsChange([]);
    setClearSignal((current) => current + 1);
  }

  return (
    <PromptInput
      className="review-chat-prompt-input p-[1.15rem]"
      onSubmit={submitPrompt}
    >
      <PromptInputBody className="review-chat-prompt-body">
        {isRevisionRefreshBlocking ? (
          <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-sm text-amber-900">
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
                className="inline-flex h-7 shrink-0 items-center rounded-md bg-amber-500 px-2.5 text-sm font-medium text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
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
          diffLineAttachmentRequest={diffLineAttachmentRequest}
          disabled={!canSubmitPrompt}
          knownIssues={knownIssues}
          knownPullRequests={knownPullRequests}
          onChange={handlePromptDraftChange}
          onDiffLineAttachmentRequestHandled={onDiffLineAttachmentRequestHandled}
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
        <PromptInputFooter
          className={`review-chat-prompt-footer ${
            isOpenCodeRuntime ? "justify-end" : "justify-between"
          }`}
        >
          {reviewRuntime === "codex" ? (
            <PromptModeToggle
              disabled={!hasSession}
              pendingValue={pendingReviewEffortMode}
              value={reviewEffortMode}
              onValueChange={onReviewEffortModeChange}
            />
          ) : null}
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
      {hasSession ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 px-2">
          <ReviewRuntimeSelector
            disabled={!hasSession || isChatBusy}
            value={reviewRuntime}
            onValueChange={onReviewRuntimeChange}
          />
          {isOpenCodeRuntime ? (
            <RuntimeModelSelector
              disabled={!hasSession || isChatBusy}
              isLoading={isLoadingRuntimeModels}
              models={runtimeModelOptions}
              value={runtimeModelChoice}
              onValueChange={onRuntimeModelChange}
            />
          ) : null}
        </div>
      ) : null}
    </PromptInput>
  );
}

export { PromptComposer };
