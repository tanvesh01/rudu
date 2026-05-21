import { PlusIcon, WrenchScrewdriverIcon } from "@heroicons/react/20/solid";
import { useEffect, useRef, useState } from "react";
import { Shimmer } from "../../components/ai-elements/shimmer";
import { PullRequestMarkdown } from "../../components/ui/pull-request-markdown";
import {
  getToolPartErrorText,
  getToolPartState,
  getToolPartTitle,
  ToolJsonDetails,
} from "./assistant-part";
import type { AssistantTurnActivityItem } from "./assistant-turn-view";
import { useReviewChatRenderDebug } from "./review-chat-debug";

function toolStatusLabel(item: AssistantTurnActivityItem & { kind: "tools" }) {
  const hasError = item.parts.some((part) =>
    Boolean(getToolPartErrorText(part)),
  );
  if (hasError) return "failed";

  const isDone = item.parts.every(
    (part) => getToolPartState(part) === "output-available",
  );
  return isDone ? "done" : "working";
}

function statusDotClassName(status: string) {
  if (status === "failed") return "bg-red-500";
  if (status === "done") return "bg-emerald-500";
  return "bg-amber-400";
}

function ProgressActivityRow({ text }: { text: string }) {
  return (
    <div className="rounded-md px-2 py-1.5 text-ink-600 dark:border-ink-800/70">
      <div className="prose prose-sm max-w-none break-words text-xs leading-5 dark:prose-invert prose-p:my-1 prose-p:text-xs prose-p:leading-5 prose-p:text-ink-600 prose-code:text-ink-700">
        <PullRequestMarkdown body={text} size="compact" />
      </div>
    </div>
  );
}

function PlanActivityRow({
  item,
}: {
  item: AssistantTurnActivityItem & { kind: "plan" };
}) {
  return (
    <div className="rounded-md border border-sky-100 bg-sky-50/60 px-2 py-1.5 text-sm text-sky-900 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-200">
      <p className="font-medium">Plan updated</p>
      <ul className="mt-1 space-y-0.5">
        {item.part.data.entries.map((entry, index) => (
          <li className="flex min-w-0 gap-2" key={`${entry.content}-${index}`}>
            <span className="min-w-0 flex-1 truncate">{entry.content}</span>
            <span className="shrink-0 font-mono text-xs opacity-70">
              {entry.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ToolActivityRow({
  item,
}: {
  item: AssistantTurnActivityItem & { kind: "tools" };
}) {
  const status = toolStatusLabel(item);
  const title =
    item.parts.length === 1
      ? getToolPartTitle(item.parts[0]!)
      : `${item.parts.length} tool calls`;

  return (
    <div className="rounded-md px-2 py-1.5 text-sm text-ink-600 dark:border-ink-800/70">
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-label={status}
          className={`size-2 shrink-0 rounded-full ${statusDotClassName(status)}`}
          title={status}
        />
        <WrenchScrewdriverIcon
          aria-hidden="true"
          className="size-3.5 shrink-0 text-ink-400"
        />
        <span className="min-w-0 flex-1 truncate text-xs">{title}</span>
      </div>
      {item.parts.length > 1 ? (
        <ul className="mt-1 space-y-0.5 pl-2 text-xs leading-5 text-ink-500">
          {item.parts.map((part) => (
            <li className="truncate" key={part.toolCallId}>
              {getToolPartTitle(part)}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-1 pl-6">
        <ToolJsonDetails openOnIssue={false} parts={item.parts} />
      </div>
    </div>
  );
}

function ActivityItem({ item }: { item: AssistantTurnActivityItem }) {
  if (item.kind === "progress") {
    return <ProgressActivityRow text={item.text} />;
  }

  if (item.kind === "plan") {
    return <PlanActivityRow item={item} />;
  }

  return <ToolActivityRow item={item} />;
}

function ReviewChatTurnActivity({
  isActive,
  items,
  triggerLabel,
  variant = "activity",
}: {
  isActive: boolean;
  items: AssistantTurnActivityItem[];
  triggerLabel?: string;
  variant?: "activity" | "status";
}) {
  const [isOpen, setIsOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  useReviewChatRenderDebug("ReviewChatTurnActivity", () => ({
    isActive,
    isOpen,
    itemCount: items.length,
    triggerLabel: triggerLabel ?? "none",
    variant,
  }));

  useEffect(() => {
    if (!isActive || !isOpen || !contentRef.current) return;
    contentRef.current.scrollTop = contentRef.current.scrollHeight;
  }, [isActive, isOpen, items]);

  if (items.length === 0) return null;

  const isStatusTrigger = variant === "status";
  const label = triggerLabel ?? (isActive ? "Activity" : "Show activity");

  return (
    <details
      className={
        isStatusTrigger
          ? "group/activity text-sm text-ink-500"
          : "group/activity rounded-lg border border-ink-100 bg-surface/70 text-sm text-ink-500 dark:border-ink-800/70"
      }
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
      open={isOpen}
    >
      <summary
        className={
          isStatusTrigger
            ? "flex min-w-0 cursor-pointer select-none items-center gap-1.5 py-1 text-sm leading-6 text-ink-400 transition hover:text-ink-700 [&::-webkit-details-marker]:hidden"
            : "flex min-w-0 cursor-pointer select-none items-center gap-2 px-2 py-1.5 text-sm font-medium text-ink-500 transition hover:text-ink-800 [&::-webkit-details-marker]:hidden"
        }
      >
        <PlusIcon
          aria-hidden="true"
          className="size-3.5 shrink-0 text-ink-400"
        />
        <span className="min-w-0 flex-1 truncate">
          {isActive ? (
            <Shimmer
              as="span"
              className="inline-block max-w-full truncate align-bottom"
              duration={1.8}
            >
              {label}
            </Shimmer>
          ) : (
            label
          )}
        </span>
      </summary>
      {isOpen ? (
        <div
          className={
            isStatusTrigger
              ? "mt-1 max-h-44 space-y-1.5 overflow-y-auto rounded-lg bg-surface/70 scrollbar-hidden dark:border-ink-800/70"
              : "max-h-44 space-y-1.5 overflow-y-auto border-t border-ink-100 scrollbar-hidden dark:border-ink-800/70"
          }
          ref={contentRef}
        >
          {items.map((item, index) => (
            <ActivityItem item={item} key={`${item.kind}-${index}`} />
          ))}
        </div>
      ) : null}
    </details>
  );
}

export { ReviewChatTurnActivity };
