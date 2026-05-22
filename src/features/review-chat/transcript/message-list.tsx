import { Fragment, type ReactNode } from "react";
import {
  ArrowTopRightOnSquareIcon,
  ChatBubbleLeftRightIcon,
  CodeBracketIcon,
  DocumentTextIcon,
  MapIcon,
} from "@heroicons/react/20/solid";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  Attachments,
  Checkpoint,
  CheckpointIcon,
  CheckpointTrigger,
  ConversationContent,
  Message,
  MessageContent,
} from "../../../components/ai-elements/chat";
import {
  AssistantPart,
  AssistantStreamingThinking,
  AssistantWorkedStatus,
  getReasoningTitle,
} from "./assistant-part";
import { getAssistantTurnView } from "./turn-view";
import type { ReviewChatMessage } from "../runtime/transport";
import { ReviewChatTurnActivity } from "./turn-activity";
import {
  getReviewChatAttachmentSubtitle,
  getReviewChatAttachmentTitle,
  getMessageAttachmentStripItems,
  normalizeInlineAttachmentsFromMetadata,
  splitTextByInlineAttachments,
  type ReviewChatAttachment,
  type ReviewChatCommandMetadata,
  type ReviewChatMessageMetadata,
} from "../selection/line-selection";
import { IssueAttachment } from "../attachments/IssueAttachment";
import { PullRequestAttachment } from "../attachments/PullRequestAttachment";
import { WorkspaceFileAttachment } from "../attachments/WorkspaceFileAttachment";
import { useReviewChatRenderDebug } from "../diagnostics/debug";
import type { FileStatsEntry, ReviewRevisionCheckpoint } from "../../../types/github";
import { revisionCheckpointsForMessageCount } from "./effort-markers";

type MessageListProps = {
  checkpoints: ReviewRevisionCheckpoint[];
  emptyState: ReactNode;
  fileStatsByPath?: Map<string, FileStatsEntry> | null;
  forcePendingThinking?: boolean;
  isLoadingTranscript?: boolean;
  messages: ReviewChatMessage[];
  onSelectWalkthroughFile?: (path: string) => void;
  pendingThinkingTitle?: string;
  status: string;
};

type ReviewChatPart = ReviewChatMessage["parts"][number];

function getTextPartBody(parts: ReviewChatMessage["parts"]) {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function getLatestReasoningTitle(parts: ReviewChatMessage["parts"]) {
  const reasoningText = parts
    .flatMap((part) => (part.type === "reasoning" ? [part.text] : []))
    .join("\n");

  return getReasoningTitle(reasoningText);
}

function formatWorkedDuration(metadata: ReviewChatMessageMetadata | undefined) {
  const startedAt = metadata?.startedAt;
  const finishedAt = metadata?.finishedAt;
  if (typeof startedAt !== "number" || typeof finishedAt !== "number") {
    return "Worked";
  }

  const elapsedSeconds = Math.max(
    1,
    Math.round((finishedAt - startedAt) / 1000),
  );
  if (elapsedSeconds < 60) {
    return `Worked for ${elapsedSeconds}s`;
  }

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return seconds === 0
    ? `Worked for ${minutes}m`
    : `Worked for ${minutes}m ${seconds}s`;
}

function getAttachmentIcon(attachment: ReviewChatAttachment) {
  if (attachment.kind === "pull-request") {
    return <ArrowTopRightOnSquareIcon aria-hidden="true" className="size-3.5" />;
  }

  if (attachment.kind === "issue") {
    return <ChatBubbleLeftRightIcon aria-hidden="true" className="size-3.5" />;
  }

  if (attachment.kind === "workspace-file") {
    return <DocumentTextIcon aria-hidden="true" className="size-3.5" />;
  }

  return <CodeBracketIcon aria-hidden="true" className="size-3.5" />;
}

function InlineAttachment({ attachment }: { attachment: ReviewChatAttachment }) {
  if (attachment.kind === "workspace-file") {
    return <WorkspaceFileAttachment attachment={attachment} />;
  }

  if (attachment.kind === "pull-request") {
    return <PullRequestAttachment attachment={attachment} />;
  }

  if (attachment.kind === "issue") {
    return <IssueAttachment attachment={attachment} />;
  }

  return null;
}

function UserMessageText({
  body,
  metadata,
}: {
  body: string;
  metadata: ReviewChatMessageMetadata | undefined;
}) {
  const segments = splitTextByInlineAttachments(
    body,
    normalizeInlineAttachmentsFromMetadata(metadata),
  );

  return (
    <p className="whitespace-pre-wrap break-words">
      {segments.map((segment, index) =>
        segment.kind === "text" ? (
          <Fragment key={`text-${index}`}>{segment.text}</Fragment>
        ) : (
          <InlineAttachment
            attachment={segment.attachment}
            key={`attachment-${segment.start}-${segment.end}-${index}`}
          />
        ),
      )}
    </p>
  );
}

function ReviewChatCommandChip({
  command,
}: {
  command: ReviewChatCommandMetadata;
}) {
  if (command.kind !== "review-walkthrough") {
    return null;
  }

  return (
    <div className="flex justify-end">
      <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-ink-200 bg-surface px-2.5 py-1 text-sm font-medium text-ink-800 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-100">
        <MapIcon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">{command.label}</span>
      </span>
    </div>
  );
}

function shortSha(value: string) {
  return value.slice(0, 7);
}

function RevisionCheckpointMarker({
  checkpoint,
}: {
  checkpoint: ReviewRevisionCheckpoint;
}) {
  return (
    <Checkpoint>
      <CheckpointIcon />
      <CheckpointTrigger disabled>
        PR refreshed to {shortSha(checkpoint.headSha)}
      </CheckpointTrigger>
      <div className="h-px min-w-0 flex-1 bg-ink-100" />
    </Checkpoint>
  );
}

function MessageList({
  checkpoints,
  emptyState,
  fileStatsByPath,
  forcePendingThinking = false,
  isLoadingTranscript = false,
  messages,
  onSelectWalkthroughFile,
  pendingThinkingTitle = "Thinking",
  status,
}: MessageListProps) {
  const shouldShowPendingThinking =
    (forcePendingThinking || status === "submitted" || status === "streaming") &&
    messages[messages.length - 1]?.role !== "assistant";
  const hasTimelineMarkers = checkpoints.length > 0;
  useReviewChatRenderDebug("MessageList", () => {
    const latestMessage = messages[messages.length - 1];
    return {
      checkpointCount: checkpoints.length,
      forcePendingThinking,
      latestMessageParts: latestMessage?.parts.length ?? 0,
      latestMessageRole: latestMessage?.role ?? "none",
      messageCount: messages.length,
      shouldShowPendingThinking,
      status,
    };
  });

  return (
    <ConversationContent className="h-full px-[1.15rem] pb-3 pt-14">
      {messages.length === 0 && !shouldShowPendingThinking && !hasTimelineMarkers ? (
        <div className="flex h-full min-h-0 w-full">
          {isLoadingTranscript ? (
            <div className="flex h-full min-h-0 w-full items-center justify-center text-sm font-medium text-ink-500">
              Restoring Review Chat
            </div>
          ) : (
            emptyState
          )}
        </div>
      ) : (
        <div className="mt-auto space-y-3">
          {revisionCheckpointsForMessageCount(checkpoints, 0).map(
            (checkpoint) => (
              <RevisionCheckpointMarker
                checkpoint={checkpoint}
                key={checkpoint.id}
              />
            ),
          )}

          {messages.map((message, messageIndex) => {
            const body = getTextPartBody(message.parts);
            const messageCheckpoints = revisionCheckpointsForMessageCount(
              checkpoints,
              messageIndex + 1,
            );

            if (message.role === "user") {
              const attachments = getMessageAttachmentStripItems(
                message.metadata,
              );
              const command = message.metadata?.command;

              return (
                <Fragment key={message.id}>
                  <Message key={message.id} messageRole="user">
                    {command ? (
                      <ReviewChatCommandChip command={command} />
                    ) : (
                      <MessageContent
                        className="space-y-2 rounded-lg bg-canvas px-3 text-ink-900"
                        messageRole="user"
                      >
                        {attachments.length > 0 ? (
                          <Attachments className="justify-end">
                            {attachments.map((attachment) => (
                              <Attachment
                                className="border-ink-200 bg-surface text-ink-900"
                                key={attachment.id}
                              >
                                <AttachmentPreview
                                  className="bg-ink-200 text-ink-700"
                                  icon={getAttachmentIcon(attachment)}
                                />
                                <AttachmentInfo
                                  className="[&_p:last-child]:text-ink-500 [&_p]:text-ink-900"
                                  subtitle={getReviewChatAttachmentSubtitle(
                                    attachment,
                                  )}
                                  title={getReviewChatAttachmentTitle(
                                    attachment,
                                  )}
                                />
                              </Attachment>
                            ))}
                          </Attachments>
                        ) : null}
                        <UserMessageText
                          body={body}
                          metadata={message.metadata}
                        />
                      </MessageContent>
                    )}
                  </Message>
                  {messageCheckpoints.map((checkpoint) => (
                    <RevisionCheckpointMarker
                      checkpoint={checkpoint}
                      key={checkpoint.id}
                    />
                  ))}
                </Fragment>
              );
            }

            const isActiveAssistantMessage =
              (status === "submitted" || status === "streaming") &&
              messageIndex === messages.length - 1;
            const turnView = getAssistantTurnView(message.parts);
            const latestReasoningTitle = getLatestReasoningTitle(message.parts);
            const workedLabel = formatWorkedDuration(message.metadata);
            const shouldRevealFinal =
              !isActiveAssistantMessage &&
              messageIndex === messages.length - 1;
            const finalTextPart: ReviewChatPart = {
              text: turnView.finalText || " ",
              type: "text",
            };
            const walkthroughParts = message.parts.filter(
              (part) => part.type === "data-review-walkthrough",
            );

            return (
              <Fragment key={message.id}>
                <Message key={message.id} messageRole="assistant">
                  <MessageContent className="space-y-2" messageRole="assistant">
                    <div className="min-w-0 flex-1 space-y-2">
                      {isActiveAssistantMessage ? (
                        turnView.hasActivity ? (
                          <ReviewChatTurnActivity
                            isActive
                            items={turnView.activityItems}
                            triggerLabel={latestReasoningTitle}
                            variant="status"
                          />
                        ) : (
                          <AssistantStreamingThinking
                            title={latestReasoningTitle}
                          />
                        )
                      ) : turnView.hasActivity ? (
                        <ReviewChatTurnActivity
                          isActive={false}
                          items={turnView.activityItems}
                          triggerLabel={workedLabel}
                          variant="status"
                        />
                      ) : (
                        <AssistantWorkedStatus label={workedLabel} />
                      )}
                      {!isActiveAssistantMessage && turnView.finalText ? (
                        <AssistantPart
                          fileStatsByPath={fileStatsByPath}
                          key="final-answer"
                          part={finalTextPart}
                          revealFinal={shouldRevealFinal}
                        />
                      ) : null}
                      {!isActiveAssistantMessage
                        ? walkthroughParts.map((part, index) => (
                            <AssistantPart
                              fileStatsByPath={fileStatsByPath}
                              key={`review-walkthrough-${index}`}
                              onSelectWalkthroughFile={
                                onSelectWalkthroughFile
                              }
                              part={part}
                            />
                          ))
                        : null}
                    </div>
                  </MessageContent>
                </Message>
                {messageCheckpoints.map((checkpoint) => (
                  <RevisionCheckpointMarker
                    checkpoint={checkpoint}
                    key={checkpoint.id}
                  />
                ))}
              </Fragment>
            );
          })}
          {shouldShowPendingThinking ? (
            <Message messageRole="assistant">
              <MessageContent className="space-y-2" messageRole="assistant">
                <AssistantStreamingThinking title={pendingThinkingTitle} />
              </MessageContent>
            </Message>
          ) : null}
        </div>
      )}
    </ConversationContent>
  );
}

export { MessageList };
