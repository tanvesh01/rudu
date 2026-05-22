import { AnimatedMarkdown } from "flowtoken";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import "flowtoken/dist/styles.css";
import {
  MessageResponse,
  Reasoning,
  Tool,
} from "../../../components/ai-elements/chat";
import { Shimmer } from "../../../components/ai-elements/shimmer";
import { PullRequestMarkdown } from "../../../components/ui/pull-request-markdown";
import styles from "./assistant-part.module.css";
import {
  isToolPart,
  type ReviewChatPart,
  type ReviewChatToolPart,
} from "./turn-view";
import { useReviewChatRenderDebug } from "../diagnostics/debug";
import { ReviewWalkthroughView } from "../walkthrough/view";
import type { ReviewChatAcpPlan } from "../runtime/transport";
import type { FileStatsEntry } from "../../../types/github";

function AcpPlanView({ plan }: { plan: ReviewChatAcpPlan }) {
  if (plan.entries.length === 0) return null;

  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50/70 px-2 py-1.5 text-sm text-sky-900 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-200">
      <p className="mb-1 font-medium">Plan</p>
      <ul className="space-y-1">
        {plan.entries.map((entry, index) => (
          <li
            className="flex items-start gap-2"
            key={`${entry.content}-${index}`}
          >
            <span className="mt-1 size-1.5 shrink-0 rounded-full bg-current opacity-60" />
            <span className="min-w-0 flex-1">{entry.content}</span>
            <span className="shrink-0 rounded-full bg-white/70 px-1.5 py-0.5 font-mono text-sm dark:bg-black/20">
              {entry.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
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

function getToolPartValue(part: ReviewChatToolPart, key: string) {
  return key in part ? (part as Record<string, unknown>)[key] : undefined;
}

function toolPartDebugPayload(part: ReviewChatToolPart) {
  return {
    toolCallId: part.toolCallId,
    title: getToolPartTitle(part),
    state: getToolPartState(part),
    toolName: getToolPartValue(part, "toolName"),
    input: getToolPartValue(part, "input"),
    output: getToolPartValue(part, "output"),
    errorText: getToolPartErrorText(part),
  };
}

function ToolJsonDetails({
  label = "Debug JSON",
  openOnIssue = true,
  parts,
}: {
  label?: string;
  openOnIssue?: boolean;
  parts: ReviewChatToolPart[];
}) {
  const hasPendingOrFailedTool = parts.some((part) => {
    const state = getToolPartState(part);
    return state !== "output-available" || Boolean(getToolPartErrorText(part));
  });
  const payload =
    parts.length === 1
      ? toolPartDebugPayload(parts[0])
      : parts.map(toolPartDebugPayload);

  return (
    <details
      className="group/json"
      open={openOnIssue && hasPendingOrFailedTool}
    >
      <summary className="inline-flex cursor-pointer select-none items-center gap-1 rounded-md px-1 py-0.5 font-mono text-sm uppercase tracking-normal text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800/50">
        {label}
      </summary>
      <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-ink-200 bg-canvas p-2 font-mono text-sm leading-5 text-ink-700 dark:border-ink-800 dark:text-ink-200">
        {JSON.stringify(
          payload,
          (_key, value) => (value === undefined ? null : value),
          2,
        )}
      </pre>
    </details>
  );
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
    <div className="prose prose-sm max-w-none break-words text-sm leading-6 dark:prose-invert prose-p:my-3 prose-p:text-sm prose-p:leading-6 prose-p:text-ink-800 prose-a:text-ink-700 prose-a:underline prose-a:underline-offset-2 hover:prose-a:text-ink-900 prose-strong:text-ink-900 prose-code:font-normal prose-code:text-ink-900 prose-pre:font-normal prose-pre:bg-transparent prose-pre:p-0 prose-ul:my-3 prose-ul:list-disc prose-ul:pl-6 prose-ol:my-3 prose-ol:list-decimal prose-ol:pl-6 prose-li:my-1 prose-li:pl-0 prose-li:text-sm prose-li:leading-6 prose-li:text-ink-800">
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

function compactReasoningTitle(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 120) return normalized;
  return `${normalized.slice(0, 117).trimEnd()}...`;
}

function getReasoningTitle(markdown: string) {
  const text = markdown.trimStart();
  if (!text) return "Thinking";

  const markdownHeadings = [...text.matchAll(/^#{1,6}\s+([^\n]+)/gm)];
  const latestMarkdownHeading =
    markdownHeadings[markdownHeadings.length - 1]?.[1];
  if (latestMarkdownHeading) {
    return compactReasoningTitle(latestMarkdownHeading);
  }

  const boldHeadings = [
    ...text.matchAll(/(?:^|\n)\s*\*\*([^*\n]+)\*\*(?:\s*\n|$)/g),
  ];
  const latestBoldHeading = boldHeadings[boldHeadings.length - 1]?.[1];
  if (latestBoldHeading) {
    return compactReasoningTitle(latestBoldHeading);
  }

  const firstLine = text.split("\n").find((line) => line.trim());
  return firstLine ? compactReasoningTitle(firstLine) : "Thinking";
}

function AssistantStreamingThinking({ title }: { title: string }) {
  useReviewChatRenderDebug("AssistantStreamingThinking", () => ({ title }));

  return (
    <div
      aria-live="polite"
      className="relative min-h-6 overflow-hidden py-1 text-sm leading-6 text-ink-400"
    >
      <AnimatePresence initial={false} mode="popLayout">
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="truncate"
          exit={{ opacity: 0, y: -10 }}
          initial={{ opacity: 0, y: 10 }}
          key={title}
          transition={{ duration: 0.22, ease: [0.23, 0.88, 0.26, 0.92] }}
        >
          <Shimmer
            as="span"
            className="inline-block max-w-full truncate align-bottom"
            duration={1.8}
          >
            {title}
          </Shimmer>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function AssistantWorkedStatus({ label }: { label: string }) {
  return (
    <div className="py-1 text-sm leading-6 text-ink-400">
      <span>{label}</span>
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
    >
      <ToolJsonDetails parts={parts} />
    </Tool>
  );
}

function AssistantPart({
  fileStatsByPath,
  isStreaming = false,
  onSelectWalkthroughFile,
  part,
  revealFinal = false,
}: {
  fileStatsByPath?: Map<string, FileStatsEntry> | null;
  isStreaming?: boolean;
  onSelectWalkthroughFile?: (path: string) => void;
  part: ReviewChatPart;
  revealFinal?: boolean;
}) {
  if (part.type === "text") {
    const body = part.text || " ";

    return (
      <MessageResponse>
        {isStreaming ? (
          <StreamingMarkdownResponse body={body} />
        ) : revealFinal ? (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            initial={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.24, ease: [0.23, 0.88, 0.26, 0.92] }}
          >
            <PullRequestMarkdown body={body} size="compact" />
          </motion.div>
        ) : (
          <PullRequestMarkdown body={body} size="compact" />
        )}
      </MessageResponse>
    );
  }

  if (part.type === "reasoning") {
    const body = part.text || " ";

    if (!isStreaming) {
      return null;
    }

    return (
      <Reasoning
        isStreaming={part.state === "streaming"}
        title={getReasoningTitle(body)}
      >
        <PullRequestMarkdown body={body} size="compact" />
      </Reasoning>
    );
  }

  if (part.type === "data-acp-plan") {
    return <AcpPlanView plan={part.data} />;
  }

  if (part.type === "data-review-walkthrough") {
    return (
      <ReviewWalkthroughView
        fileStatsByPath={fileStatsByPath}
        onSelectFile={onSelectWalkthroughFile}
        walkthrough={part.data}
      />
    );
  }

  if (isToolPart(part)) {
    return (
      <Tool
        errorText={getToolPartErrorText(part)}
        state={getToolPartState(part)}
        title={getToolPartTitle(part)}
      >
        <ToolJsonDetails parts={[part]} />
      </Tool>
    );
  }

  return null;
}

export {
  AssistantPart,
  AssistantStreamingThinking,
  AssistantWorkedStatus,
  AssistantToolGroup,
  getToolPartErrorText,
  getToolPartState,
  getToolPartTitle,
  getReasoningTitle,
  isToolPart,
  ToolJsonDetails,
};
export type { ReviewChatToolPart };
