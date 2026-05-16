import {
  ArrowPathIcon,
  ArrowUpIcon,
  ArrowTopRightOnSquareIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/20/solid";
import { Command } from "cmdk";
import Fuse from "fuse.js";
import { useMemo, useRef, useState, type FormEvent } from "react";
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
  createPullRequestAttachment,
  createWorkspaceFileAttachment,
  getReviewChatAttachmentKey,
  getReviewChatAttachmentSubtitle,
  getReviewChatAttachmentTitle,
  type ReviewChatAttachment,
} from "./line-selection";
import {
  isRevisionRefreshBlockingPrompt,
  type RevisionRefreshGateState,
} from "./revision-refresh-gate-store";
import { getPullRequestSummary } from "../../queries/github-native";

type PromptComposerProps = {
  attachments: ReviewChatAttachment[];
  canSend: boolean;
  currentRepo: string | null;
  isChatBusy: boolean;
  hasSession: boolean;
  isLoadingWorkspaceFiles: boolean;
  revisionRefreshGate: Pick<
    RevisionRefreshGateState,
    "error" | "mode" | "revision"
  >;
  sessionHeadSha: string | null;
  sessionId: string | null;
  workspaceFiles: string[];
  onAddAttachment(attachment: ReviewChatAttachment): void;
  onRemoveAttachment(attachmentId: string): void;
  onRefreshRevision(): void;
  onSend(text: string): void;
  onStop(): void;
};

type ActiveMention = {
  end: number;
  query: string;
  start: number;
};

type PullRequestMentionTarget = {
  displayText: string;
  number: number;
  repo: string;
};

type MentionSuggestion =
  | {
      kind: "workspace-file";
      path: string;
    }
  | {
      kind: "pull-request";
      target: PullRequestMentionTarget;
    };

function getActiveMention(
  prompt: string,
  caretIndex: number,
): ActiveMention | null {
  const beforeCaret = prompt.slice(0, caretIndex);
  const match = beforeCaret.match(/(?:^|\s)@([^\s@]*)$/);
  if (!match || match.index === undefined) {
    return null;
  }

  return {
    start: match.index + match[0].lastIndexOf("@"),
    end: caretIndex,
    query: match[1] ?? "",
  };
}

function parsePullRequestMention(
  query: string,
  currentRepo: string | null,
): PullRequestMentionTarget | null {
  const currentRepoMatch = query.match(/^#([1-9]\d*)$/);
  if (currentRepoMatch && currentRepo) {
    const number = Number(currentRepoMatch[1] ?? 0);
    return {
      repo: currentRepo,
      number,
      displayText: `#${number}`,
    };
  }

  const crossRepoMatch = query.match(
    /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#([1-9]\d*)$/,
  );
  if (!crossRepoMatch) {
    return null;
  }

  const repo = crossRepoMatch[1] ?? "";
  const number = Number(crossRepoMatch[2] ?? 0);
  return {
    repo,
    number,
    displayText: `${repo}#${number}`,
  };
}

function getMentionReplacement(suggestion: MentionSuggestion) {
  if (suggestion.kind === "workspace-file") {
    return `@${suggestion.path}`;
  }

  return `@${suggestion.target.displayText}`;
}

function getMentionKey(mention: ActiveMention) {
  return `${mention.start}:${mention.end}:${mention.query}`;
}

function getReplacementMentionKey(
  mention: ActiveMention,
  replacement: string,
) {
  return `${mention.start}:${mention.start + replacement.length}:${replacement.slice(
    1,
  )}`;
}

function getAttachmentIcon(attachment: ReviewChatAttachment) {
  if (attachment.kind === "pull-request") {
    return <ArrowTopRightOnSquareIcon aria-hidden="true" className="size-3.5" />;
  }

  if (attachment.kind === "workspace-file") {
    return <DocumentTextIcon aria-hidden="true" className="size-3.5" />;
  }

  return undefined;
}

function PromptComposer({
  attachments,
  canSend,
  currentRepo,
  hasSession,
  isChatBusy,
  isLoadingWorkspaceFiles,
  revisionRefreshGate,
  sessionHeadSha,
  sessionId,
  workspaceFiles,
  onAddAttachment,
  onRemoveAttachment,
  onRefreshRevision,
  onSend,
  onStop,
}: PromptComposerProps) {
  const [prompt, setPrompt] = useState("");
  const [caretIndex, setCaretIndex] = useState(0);
  const [dismissedMentionKey, setDismissedMentionKey] = useState<string | null>(
    null,
  );
  const [mentionError, setMentionError] = useState("");
  const [isResolvingMention, setIsResolvingMention] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isRevisionRefreshBlocking = isRevisionRefreshBlockingPrompt(
    revisionRefreshGate.mode,
  );
  const canSubmitPrompt = canSend && !isRevisionRefreshBlocking;
  const isRefreshButtonDisabled =
    isChatBusy || revisionRefreshGate.mode === "refreshing";
  const shortLatestHeadSha =
    revisionRefreshGate.revision?.latestHeadSha.slice(0, 7) ?? null;
  const visibleMention = getActiveMention(prompt, caretIndex);
  const activeMention =
    visibleMention && getMentionKey(visibleMention) !== dismissedMentionKey
      ? visibleMention
      : null;
  const fileFuse = useMemo(
    () =>
      new Fuse(workspaceFiles, {
        ignoreLocation: true,
        threshold: 0.35,
      }),
    [workspaceFiles],
  );
  const mentionSuggestions = useMemo<MentionSuggestion[]>(() => {
    if (!activeMention || !sessionId || !sessionHeadSha) {
      return [];
    }

    const query = activeMention.query.trim();
    const pullRequestTarget = parsePullRequestMention(query, currentRepo);
    if (pullRequestTarget) {
      return [{ kind: "pull-request", target: pullRequestTarget }];
    }

    if (query.includes("#")) {
      return [];
    }

    const paths = query
      ? fileFuse.search(query, { limit: 8 }).map((result) => result.item)
      : workspaceFiles.slice(0, 8);

    return paths.map((path) => ({ kind: "workspace-file", path }));
  }, [
    activeMention,
    currentRepo,
    fileFuse,
    sessionHeadSha,
    sessionId,
    workspaceFiles,
  ]);
  const shouldShowMentionMenu =
    Boolean(activeMention) &&
    hasSession &&
    !isRevisionRefreshBlocking;

  function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || !canSubmitPrompt) return;
    setPrompt("");
    setCaretIndex(0);
    setDismissedMentionKey(null);
    onSend(text);
  }

  function syncCaretFromTextarea(textarea: HTMLTextAreaElement) {
    setCaretIndex(textarea.selectionStart ?? 0);
  }

  function replaceActiveMentionText(
    mention: ActiveMention,
    replacement: string,
    dismissMention: boolean,
  ) {
    const nextPrompt = `${prompt.slice(0, mention.start)}${replacement}${prompt.slice(
      mention.end,
    )}`;
    const nextCaretIndex = mention.start + replacement.length;
    setPrompt(nextPrompt);
    setCaretIndex(nextCaretIndex);
    setDismissedMentionKey(
      dismissMention ? getReplacementMentionKey(mention, replacement) : null,
    );
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaretIndex, nextCaretIndex);
    });
  }

  async function selectMention(suggestion: MentionSuggestion) {
    if (!activeMention) return;
    setMentionError("");
    const replacement = getMentionReplacement(suggestion);
    const replacementMentionKey = getReplacementMentionKey(
      activeMention,
      replacement,
    );
    replaceActiveMentionText(
      activeMention,
      replacement,
      suggestion.kind === "workspace-file",
    );

    if (suggestion.kind === "workspace-file") {
      onAddAttachment(createWorkspaceFileAttachment(suggestion.path));
      return;
    }

    setIsResolvingMention(true);
    try {
      const pullRequest = await getPullRequestSummary({
        repo: suggestion.target.repo,
        number: suggestion.target.number,
      });
      onAddAttachment(
        createPullRequestAttachment(suggestion.target.repo, pullRequest),
      );
      setDismissedMentionKey(replacementMentionKey);
    } catch (error) {
      setMentionError(
        error instanceof Error
          ? error.message
          : "Failed to resolve pull request mention.",
      );
    } finally {
      setIsResolvingMention(false);
    }
  }

  return (
    <PromptInput onSubmit={submitPrompt}>
      {attachments.length > 0 ? (
        <PromptInputHeader>
          <Attachments>
            {attachments.map((attachment) => {
              const attachmentId = getReviewChatAttachmentKey(attachment);
              return (
                <Attachment key={attachmentId}>
                  <AttachmentPreview icon={getAttachmentIcon(attachment)} />
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
        {shouldShowMentionMenu ? (
          <Command
            className="mb-2 max-h-48 overflow-y-auto rounded-md border border-ink-200 bg-surface p-1 shadow-sm"
            shouldFilter={false}
          >
            <Command.List>
              {isLoadingWorkspaceFiles ? (
                <Command.Loading className="px-2 py-2 text-xs text-ink-500">
                  Loading files...
                </Command.Loading>
              ) : null}
              {isResolvingMention ? (
                <Command.Loading className="px-2 py-2 text-xs text-ink-500">
                  Resolving pull request...
                </Command.Loading>
              ) : null}
              {mentionError ? (
                <div className="px-2 py-2 text-xs text-danger-600">
                  {mentionError}
                </div>
              ) : null}
              {!isLoadingWorkspaceFiles &&
              !isResolvingMention &&
              !mentionError &&
              mentionSuggestions.length === 0 ? (
                <Command.Empty className="px-2 py-2 text-xs text-ink-500">
                  No mentions found.
                </Command.Empty>
              ) : null}
              {mentionSuggestions.map((suggestion) => {
                const value =
                  suggestion.kind === "workspace-file"
                    ? `file:${suggestion.path}`
                    : `pr:${suggestion.target.repo}#${suggestion.target.number}`;
                const title =
                  suggestion.kind === "workspace-file"
                    ? suggestion.path
                    : suggestion.target.displayText;
                const subtitle =
                  suggestion.kind === "workspace-file"
                    ? "Workspace file"
                    : "Pull request";
                return (
                  <Command.Item
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-left text-xs outline-none transition hover:bg-canvasDark aria-selected:bg-canvasDark data-[selected=true]:bg-canvasDark"
                    key={value}
                    onMouseDown={(event) => event.preventDefault()}
                    onSelect={() => void selectMention(suggestion)}
                    value={value}
                  >
                    <AttachmentPreview
                      className="mt-0"
                      icon={
                        suggestion.kind === "workspace-file" ? (
                          <DocumentTextIcon
                            aria-hidden="true"
                            className="size-3.5"
                          />
                        ) : (
                          <ArrowTopRightOnSquareIcon
                            aria-hidden="true"
                            className="size-3.5"
                          />
                        )
                      }
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink-800">
                        {title}
                      </p>
                      <p className="truncate text-[11px] text-ink-500">
                        {subtitle}
                      </p>
                    </div>
                  </Command.Item>
                );
              })}
            </Command.List>
          </Command>
        ) : null}
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
          onBlur={(event) => syncCaretFromTextarea(event.currentTarget)}
          onChange={(event) => {
            setPrompt(event.target.value);
            syncCaretFromTextarea(event.currentTarget);
            setDismissedMentionKey(null);
            setMentionError("");
          }}
          onClick={(event) => syncCaretFromTextarea(event.currentTarget)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.currentTarget.form?.requestSubmit();
            }
          }}
          onKeyUp={(event) => syncCaretFromTextarea(event.currentTarget)}
          onSelect={(event) => syncCaretFromTextarea(event.currentTarget)}
          placeholder={
            hasSession
              ? attachments.length > 0
                ? "Ask with attached context..."
                : "Ask about this pull request..."
              : "Select a pull request to start AI chat"
          }
          ref={textareaRef}
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
