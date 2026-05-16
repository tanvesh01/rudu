import {
  MessageResponse,
  Reasoning,
  Tool,
} from "../../components/ai-elements/chat";
import { PullRequestMarkdown } from "../../components/ui/pull-request-markdown";
import type {
  RemoteReviewAcpPlan,
  RemoteReviewChatMessage,
} from "./transport";

type RemoteReviewChatPart = RemoteReviewChatMessage["parts"][number];
type RemoteReviewChatToolPart = RemoteReviewChatPart & { toolCallId: string };

function AcpPlanView({ plan }: { plan: RemoteReviewAcpPlan }) {
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

function isToolPart(part: RemoteReviewChatPart): part is RemoteReviewChatToolPart {
  return "toolCallId" in part;
}

function getToolPartErrorText(part: RemoteReviewChatToolPart) {
  return "errorText" in part && typeof part.errorText === "string"
    ? part.errorText
    : undefined;
}

function getToolPartState(part: RemoteReviewChatToolPart) {
  return "state" in part && typeof part.state === "string"
    ? part.state
    : "input-available";
}

function getToolPartTitle(part: RemoteReviewChatToolPart) {
  if ("title" in part && typeof part.title === "string") {
    return part.title;
  }

  if ("toolName" in part && typeof part.toolName === "string") {
    return part.toolName;
  }

  return part.toolCallId;
}

function AssistantToolGroup({ parts }: { parts: RemoteReviewChatToolPart[] }) {
  const count = parts.length;
  const errorText = parts.map(getToolPartErrorText).find(Boolean);
  const isDone = parts.every(
    (part) => getToolPartState(part) === "output-available",
  );

  return (
    <Tool
      errorText={typeof errorText === "string" ? errorText : undefined}
      state={isDone ? "output-available" : "input-available"}
      title={`${count} Tool ${count === 1 ? "call" : "calls"}`}
    />
  );
}

function AssistantPart({ part }: { part: RemoteReviewChatPart }) {
  if (part.type === "text") {
    return (
      <MessageResponse>
        <PullRequestMarkdown body={part.text || " "} size="compact" />
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
export type { RemoteReviewChatToolPart };
