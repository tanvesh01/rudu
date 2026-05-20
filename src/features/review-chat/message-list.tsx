import {
  Fragment,
  type ReactNode,
} from "react";
import {
  ArrowTopRightOnSquareIcon,
  ChatBubbleLeftRightIcon,
  CodeBracketIcon,
  DocumentTextIcon,
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
} from "../../components/ai-elements/chat";
import {
  AssistantPart,
  AssistantStreamingThinking,
  AssistantWorkedStatus,
  getReasoningTitle,
} from "./assistant-part";
import { getAssistantTurnView } from "./assistant-turn-view";
import type { ReviewChatMessage } from "./transport";
import { ReviewChatTurnActivity } from "./review-chat-turn-activity";
import {
  getReviewChatAttachmentSubtitle,
  getReviewChatAttachmentTitle,
  getMessageAttachmentStripItems,
  normalizeInlineAttachmentsFromMetadata,
  splitTextByInlineAttachments,
  type ReviewChatAttachment,
  type ReviewChatMessageMetadata,
} from "./line-selection";
import { IssueAttachment } from "./attachments/IssueAttachment";
import { PullRequestAttachment } from "./attachments/PullRequestAttachment";
import { WorkspaceFileAttachment } from "./attachments/WorkspaceFileAttachment";
import type { RevisionCheckpoint } from "./revision-refresh-gate-store";

type MessageListProps = {
  checkpoints: RevisionCheckpoint[];
  emptyState: ReactNode;
  messages: ReviewChatMessage[];
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

function shortSha(value: string) {
  return value.slice(0, 7);
}

function RevisionCheckpointMarker({
  checkpoint,
}: {
  checkpoint: RevisionCheckpoint;
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
  messages,
  status,
}: MessageListProps) {
  return (
    <ConversationContent className="px-[1.15rem]">
      {messages.length === 0 ? (
        <div className="flex min-h-full w-full">{emptyState}</div>
      ) : (
        <div className="mt-auto space-y-3">
          {checkpoints
            .filter((checkpoint) => checkpoint.messageCount === 0)
            .map((checkpoint) => (
              <RevisionCheckpointMarker
                checkpoint={checkpoint}
                key={checkpoint.id}
              />
            ))}

          {messages.map((message, messageIndex) => {
            const body = getTextPartBody(message.parts);
            const messageCheckpoints = checkpoints.filter(
              (checkpoint) => checkpoint.messageCount === messageIndex + 1,
            );

            if (message.role === "user") {
              const attachments = getMessageAttachmentStripItems(
                message.metadata,
              );

              return (
                <Fragment key={message.id}>
                  <Message key={message.id} messageRole="user">
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
                                title={getReviewChatAttachmentTitle(attachment)}
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

            const isActiveStreamingAssistantMessage =
              status === "streaming" && messageIndex === messages.length - 1;
            const turnView = getAssistantTurnView(message.parts);
            const latestReasoningTitle = getLatestReasoningTitle(message.parts);
            const workedLabel = formatWorkedDuration(message.metadata);
            const shouldRevealFinal =
              !isActiveStreamingAssistantMessage &&
              messageIndex === messages.length - 1;
            const finalTextPart: ReviewChatPart = {
              text: turnView.finalText || " ",
              type: "text",
            };

            return (
              <Fragment key={message.id}>
                <Message key={message.id} messageRole="assistant">
                  <MessageContent className="space-y-2" messageRole="assistant">
                    <div className="min-w-0 flex-1 space-y-2">
                      {isActiveStreamingAssistantMessage ? (
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
                      {!isActiveStreamingAssistantMessage && turnView.finalText ? (
                        <AssistantPart
                          key="final-answer"
                          part={finalTextPart}
                          revealFinal={shouldRevealFinal}
                        />
                      ) : null}
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
        </div>
      )}
    </ConversationContent>
  );
}

export { MessageList };
