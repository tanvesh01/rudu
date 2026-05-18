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
  ConversationScrollButton,
  Message,
  MessageContent,
} from "../../components/ai-elements/chat";
import {
  AssistantPart,
  AssistantStreamingThinking,
  AssistantWorkedStatus,
  AssistantToolGroup,
  getReasoningTitle,
  isToolPart,
  type ReviewChatToolPart,
} from "./assistant-part";
import type { ReviewChatMessage } from "./transport";
import {
  getReviewChatAttachmentSubtitle,
  getReviewChatAttachmentTitle,
  normalizeAttachmentsFromMetadata,
  type ReviewChatAttachment,
  type ReviewChatMessageMetadata,
} from "./line-selection";
import type { RevisionCheckpoint } from "./revision-refresh-gate-store";

type MessageListProps = {
  checkpoints: RevisionCheckpoint[];
  emptyState: ReactNode;
  messages: ReviewChatMessage[];
  status: string;
};

type ReviewChatPart = ReviewChatMessage["parts"][number];
type AssistantRenderItem =
  | { kind: "part"; part: ReviewChatPart }
  | { kind: "tools"; parts: ReviewChatToolPart[] };

function getTextPartBody(parts: ReviewChatMessage["parts"]) {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function getAssistantRenderItems(parts: ReviewChatMessage["parts"]) {
  const items: AssistantRenderItem[] = [];

  for (const part of parts) {
    if (!isToolPart(part)) {
      items.push({ kind: "part", part });
      continue;
    }

    const previousItem = items[items.length - 1];
    if (previousItem?.kind === "tools") {
      previousItem.parts.push(part);
      continue;
    }

    items.push({ kind: "tools", parts: [part] });
  }

  return items;
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
    <ConversationContent>
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
              const attachments = normalizeAttachmentsFromMetadata(
                message.metadata,
              );

              return (
                <Fragment key={message.id}>
                  <Message key={message.id} messageRole="user">
                    <MessageContent
                      className="space-y-2 rounded-lg bg-ink-100 px-3 text-ink-900 dark:bg-ink-100 dark:text-ink-900"
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
                      <p className="whitespace-pre-wrap">{body}</p>
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

            const renderItems = getAssistantRenderItems(message.parts);
            const isActiveStreamingAssistantMessage =
              status === "streaming" && messageIndex === messages.length - 1;
            const workedLabel = formatWorkedDuration(message.metadata);
            const shouldRevealFinal =
              !isActiveStreamingAssistantMessage &&
              messageIndex === messages.length - 1;

            return (
              <Fragment key={message.id}>
                <Message key={message.id} messageRole="assistant">
                  <MessageContent className="space-y-2" messageRole="assistant">
                    <div className="min-w-0 flex-1 space-y-2">
                      {isActiveStreamingAssistantMessage ? (
                        <AssistantStreamingThinking
                          title={getLatestReasoningTitle(message.parts)}
                        />
                      ) : (
                        <>
                          <AssistantWorkedStatus label={workedLabel} />
                          {renderItems.map((item, index) =>
                            item.kind === "tools" ? (
                              <AssistantToolGroup
                                key={`tools-${item.parts[0]?.toolCallId ?? index}`}
                                parts={item.parts}
                              />
                            ) : item.part.type === "reasoning" ? null : (
                              <AssistantPart
                                key={`${item.part.type}-${index}`}
                                part={item.part}
                                revealFinal={shouldRevealFinal}
                              />
                            ),
                          )}
                        </>
                      )}
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
      {messages.length > 0 ? (
        <div className="sticky bottom-0 z-10 flex justify-center pb-1">
          <ConversationScrollButton />
        </div>
      ) : null}
    </ConversationContent>
  );
}

export { MessageList };
