import { ArrowDownIcon } from "@heroicons/react/20/solid";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
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
  AssistantToolGroup,
  isToolPart,
  type RemoteReviewChatToolPart,
} from "./assistant-part";
import type { RemoteReviewChatMessage } from "./transport";
import { getSelectionAttachmentSubtitle } from "./line-selection";
import type { RevisionCheckpoint } from "./revision-refresh-gate-store";

type MessageListProps = {
  checkpoints: RevisionCheckpoint[];
  messages: RemoteReviewChatMessage[];
  status: string;
};

type RemoteReviewChatPart = RemoteReviewChatMessage["parts"][number];
type AssistantRenderItem =
  | { kind: "part"; part: RemoteReviewChatPart }
  | { kind: "tools"; parts: RemoteReviewChatToolPart[] };

function getTextPartBody(parts: RemoteReviewChatMessage["parts"]) {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function getAssistantRenderItems(parts: RemoteReviewChatMessage["parts"]) {
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

function MessageList({ checkpoints, messages, status }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isAtLatestRef = useRef(true);
  const [isAtLatest, setIsAtLatest] = useState(true);

  const updateIsAtLatest = useCallback((scrollContainer: HTMLDivElement) => {
    const distanceFromBottom =
      scrollContainer.scrollHeight -
      scrollContainer.scrollTop -
      scrollContainer.clientHeight;
    const nextIsAtLatest = distanceFromBottom < 8;
    isAtLatestRef.current = nextIsAtLatest;
    setIsAtLatest(nextIsAtLatest);
  }, []);

  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;

    const frame = requestAnimationFrame(() => {
      if (isAtLatestRef.current) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }

      updateIsAtLatest(scrollContainer);
    });

    return () => cancelAnimationFrame(frame);
  }, [checkpoints, messages, status, updateIsAtLatest]);

  function scrollToLatest() {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
    updateIsAtLatest(scrollContainer);
  }

  return (
    <ConversationContent
      onScroll={(event) => updateIsAtLatest(event.currentTarget)}
      ref={scrollRef}
    >
      {messages.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-200 bg-canvas p-3 text-sm leading-6 text-ink-500">
          Ask Pi to review a file, explain a risky diff, or investigate a
          failing check. The session stays in memory for this pull request.
        </div>
      ) : null}

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
          const selectedLineContext =
            message.metadata?.selectedLineContext ?? null;

          return (
            <Fragment key={message.id}>
              <Message key={message.id} messageRole="user">
                <MessageContent
                  className="space-y-2"
                  messageRole="user"
                >
                  {selectedLineContext ? (
                    <Attachments className="justify-end">
                      <Attachment className="border-ink-700 bg-ink-800/90 text-white">
                        <AttachmentPreview className="bg-ink-700 text-white" />
                        <AttachmentInfo
                          className="[&_p:last-child]:text-white/70 [&_p]:text-white"
                          subtitle={getSelectionAttachmentSubtitle(
                            selectedLineContext,
                          )}
                          title={selectedLineContext.path}
                        />
                      </Attachment>
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

        return (
          <Fragment key={message.id}>
            <Message key={message.id} messageRole="assistant">
              <MessageContent className="space-y-2" messageRole="assistant">
                {renderItems.map((item, index) =>
                  item.kind === "tools" ? (
                    <AssistantToolGroup
                      key={`tools-${item.parts.map((part) => part.toolCallId).join("-")}`}
                      parts={item.parts}
                    />
                  ) : (
                    <AssistantPart
                      key={`${item.part.type}-${index}`}
                      part={item.part}
                    />
                  ),
                )}
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

      {messages.length > 0 && !isAtLatest ? (
        <div className="sticky bottom-0 z-10 flex justify-center pb-1">
          <ConversationScrollButton onClick={scrollToLatest}>
            <span className="inline-flex items-center gap-1">
              <ArrowDownIcon aria-hidden="true" className="size-3.5" />
              Latest
            </span>
          </ConversationScrollButton>
        </div>
      ) : null}
    </ConversationContent>
  );
}

export { MessageList };
