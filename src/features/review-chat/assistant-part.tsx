import { AnimatedMarkdown } from "flowtoken";
import { useEffect, useRef } from "react";
import "flowtoken/dist/styles.css";
import {
  MessageResponse,
  Reasoning,
  Tool,
} from "../../components/ai-elements/chat";
import { PullRequestMarkdown } from "../../components/ui/pull-request-markdown";
import styles from "./assistant-part.module.css";
import type {
  ReviewChatAcpPlan,
  ReviewChatMessage,
} from "./transport";

type ReviewChatPart = ReviewChatMessage["parts"][number];
type ReviewChatToolPart = ReviewChatPart & { toolCallId: string };

function AcpPlanView({ plan }: { plan: ReviewChatAcpPlan }) {
  if (plan.entries.length === 0) return null;

  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50/70 px-2 py-1.5 text-xs text-sky-900 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-200">
      <p className="mb-1 font-medium">Plan</p>
      <ul className="space-y-1">
        {plan.entries.map((entry, index) => (
          <li
            className="flex items-start gap-2"
            key={`${entry.content}-${index}`}
          >
            <span className="mt-1 size-1.5 shrink-0 rounded-full bg-current opacity-60" />
            <span className="min-w-0 flex-1">{entry.content}</span>
            <span className="shrink-0 rounded-full bg-white/70 px-1.5 py-0.5 font-mono text-[10px] dark:bg-black/20">
              {entry.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function isToolPart(part: ReviewChatPart): part is ReviewChatToolPart {
  return "toolCallId" in part;
}

function getToolPartErrorText(part: ReviewChatToolPart) {
  return "errorText" in part && typeof part.errorText === "string"
    ? part.errorText
    : undefined;
}

function getToolPartState(part: ReviewChatToolPart) {
  return "state" in part && typeof part.state === "string"
    ? part.state
    : "input-available";
}

function getToolPartTitle(part: ReviewChatToolPart) {
  if ("title" in part && typeof part.title === "string") {
    return part.title;
  }

  if ("toolName" in part && typeof part.toolName === "string") {
    return part.toolName;
  }

  return part.toolCallId;
}

function AnimateCount({
  animate,
  count,
  previousCount,
}: {
  animate: boolean;
  count: number;
  previousCount: number | null;
}) {
  return (
    <span className={styles.count} data-animate={animate}>
      {animate && previousCount !== null && (
        <span aria-hidden="true" className={styles.exit}>
          {previousCount}
        </span>
      )}
      <span aria-hidden="true" className={styles.enter}>
        {count}
      </span>
    </span>
  );
}

function useIncreasingCountAnimation(count: number): [boolean, number | null] {
  const previousCountRef = useRef<number | null>(null);
  const previousCount = previousCountRef.current;
  const animate = previousCount !== null && count > previousCount;

  useEffect(() => {
    previousCountRef.current = count;
  }, [count]);

  return [animate, previousCount];
}

function RollingToolCallCount({ count }: { count: number }) {
  const label = `${count} Tool ${count === 1 ? "call" : "calls"}`;
  const [animateCount, previousCount] = useIncreasingCountAnimation(count);

  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="sr-only">{label}</span>
      <AnimateCount
        animate={animateCount}
        count={count}
        key={count}
        previousCount={previousCount}
      />
      <span aria-hidden="true">Tool {count === 1 ? "call" : "calls"}</span>
    </span>
  );
}

function StreamingMarkdownResponse({ body }: { body: string }) {
  return (
    <div className="prose prose-sm max-w-none break-words text-xs leading-5 dark:prose-invert prose-p:my-3 prose-p:text-xs prose-p:leading-5 prose-p:text-ink-800 prose-a:text-ink-700 prose-a:underline prose-a:underline-offset-2 hover:prose-a:text-ink-900 prose-strong:text-ink-900 prose-code:text-ink-900 prose-ul:my-3 prose-ul:list-disc prose-ul:pl-6 prose-ol:my-3 prose-ol:list-decimal prose-ol:pl-6 prose-li:my-1 prose-li:pl-0 prose-li:text-xs prose-li:leading-5 prose-li:text-ink-800 prose-pre:bg-transparent prose-pre:p-0">
      <AnimatedMarkdown
        animation="dropIn"
        animationDuration="0.3s"
        animationTimingFunction="ease-out"
        content={body}
        sep="word"
      />
    </div>
  );
}

function AssistantToolGroup({ parts }: { parts: ReviewChatToolPart[] }) {
  const count = parts.length;
  const errorText = parts.map(getToolPartErrorText).find(Boolean);
  const isDone = parts.every(
    (part) => getToolPartState(part) === "output-available",
  );

  return (
    <Tool
      errorText={typeof errorText === "string" ? errorText : undefined}
      state={isDone ? "output-available" : "input-available"}
      title={<RollingToolCallCount count={count} />}
    />
  );
}

function AssistantPart({
  isStreaming = false,
  part,
}: {
  isStreaming?: boolean;
  part: ReviewChatPart;
}) {
  if (part.type === "text") {
    const body = part.text || " ";

    return (
      <MessageResponse>
        {isStreaming ? (
          <StreamingMarkdownResponse body={body} />
        ) : (
          <PullRequestMarkdown body={body} size="compact" />
        )}
      </MessageResponse>
    );
  }

  if (part.type === "reasoning") {
    return (
      <Reasoning isStreaming={part.state === "streaming"}>
        <PullRequestMarkdown body={part.text || " "} size="compact" />
      </Reasoning>
    );
  }

  if (part.type === "data-acp-plan") {
    return <AcpPlanView plan={part.data} />;
  }

  if (isToolPart(part)) {
    return (
      <Tool
        errorText={getToolPartErrorText(part)}
        state={getToolPartState(part)}
        title={getToolPartTitle(part)}
      />
    );
  }

  return null;
}

export { AssistantPart, AssistantToolGroup, isToolPart };
export type { ReviewChatToolPart };
