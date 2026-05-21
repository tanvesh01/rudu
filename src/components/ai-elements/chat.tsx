import {
  ArrowDownIcon,
  BookmarkIcon,
  ChevronRightIcon,
  XMarkIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/20/solid";
import { AnimatePresence, motion } from "motion/react";
import { type ComponentProps, type ReactNode } from "react";
import {
  StickToBottom,
  type StickToBottomContext,
  useStickToBottomContext,
} from "use-stick-to-bottom";
import { Shimmer } from "./shimmer";

type ConversationContext = StickToBottomContext;

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function Conversation({
  className,
  ...props
}: ComponentProps<typeof StickToBottom>) {
  return (
    <StickToBottom
      className={cx(
        "relative flex h-full min-h-0 flex-col bg-surface",
        className,
      )}
      initial="smooth"
      resize="smooth"
      role="log"
      {...props}
    />
  );
}

function ConversationContent({
  className,
  scrollClassName,
  ...props
}: ComponentProps<typeof StickToBottom.Content>) {
  return (
    <StickToBottom.Content
      className={cx("flex min-h-full flex-col px-3 py-3", className)}
      scrollClassName={cx(
        "min-h-0 flex-1 overflow-y-auto scrollbar-hidden",
        scrollClassName,
      )}
      {...props}
    />
  );
}

function ConversationScrollButton({
  className,
  children,
  onClick,
  ...props
}: ComponentProps<typeof motion.button>) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  return (
    <AnimatePresence initial={false}>
      {!isAtBottom ? (
        <motion.button
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className={cx(
            "rounded-full border border-ink-200 bg-surface/80 px-2 py-1 text-xs font-medium text-ink-600 shadow-sm backdrop-blur transition-colors hover:bg-ink-50/90 hover:text-ink-900",
            className,
          )}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          onClick={(event) => {
            onClick?.(event);
            if (!event.defaultPrevented) {
              void scrollToBottom();
            }
          }}
          transition={{ duration: 0.18, ease: [0.23, 0.88, 0.26, 0.92] }}
          type="button"
          whileHover={{ scale: 1.03, y: -1 }}
          whileTap={{ scale: 0.97 }}
          {...props}
        >
          {children ?? (
            <span className="inline-flex items-center gap-1">
              <ArrowDownIcon aria-hidden="true" className="size-3.5" />
              Latest
            </span>
          )}
        </motion.button>
      ) : null}
    </AnimatePresence>
  );
}

function Checkpoint({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cx(
        "flex items-center gap-2 py-1 text-sm text-ink-500",
        className,
      )}
      {...props}
    />
  );
}

function CheckpointIcon({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cx(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-300",
        className,
      )}
      {...props}
    >
      <BookmarkIcon aria-hidden="true" className="size-3.5" />
    </span>
  );
}

function CheckpointTrigger({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      className={cx(
        "inline-flex h-7 shrink-0 items-center rounded-md border border-ink-200 bg-surface px-2.5 text-sm font-medium text-ink-600 transition hover:bg-ink-50 hover:text-ink-900 disabled:pointer-events-none disabled:text-ink-500",
        className,
      )}
      type="button"
      {...props}
    />
  );
}

function Message({
  className,
  messageRole,
  ...props
}: ComponentProps<"article"> & { messageRole: "assistant" | "user" }) {
  return (
    <article
      className={cx(
        "flex min-w-0",
        messageRole === "user" ? "justify-end" : "justify-start",
        className,
      )}
      data-role={messageRole}
      {...props}
    />
  );
}

function MessageContent({
  className,
  messageRole,
  ...props
}: ComponentProps<"div"> & { messageRole: "assistant" | "user" }) {
  return (
    <div
      className={cx(
        "min-w-0 max-w-[92%] rounded-2xl py-2 text-sm leading-6",
        messageRole === "user" ? "text-ink-900" : "text-ink-800",
        className,
      )}
      {...props}
    />
  );
}

function MessageResponse({ children }: { children: ReactNode }) {
  return <div className="min-w-0">{children}</div>;
}

function PromptInput({ className, ...props }: ComponentProps<"form">) {
  return (
    <form
      className={cx(
        "relative shrink-0 bg-surface p-3 before:pointer-events-none before:absolute before:inset-x-0 before:-top-12 before:h-12 before:bg-gradient-to-b before:from-transparent before:to-surface",
        className,
      )}
      {...props}
    />
  );
}

function PromptInputHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("mb-2", className)} {...props} />;
}

function PromptInputBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cx("rounded-lg bg-canvas p-2", className)} {...props} />
  );
}

function PromptInputFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cx(
        "mt-2 flex items-center justify-end gap-2 bg-canvas",
        className,
      )}
      {...props}
    />
  );
}

function PromptInputTextarea({
  className,
  ...props
}: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cx(
        "block max-h-32 min-h-10 w-full resize-none rounded-lg bg-canvas px-2 py-2 text-sm leading-5 text-ink-900 outline-none transition placeholder:text-ink-400 disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

function PromptInputSubmit({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      className={cx(
        "inline-flex items-center rounded-full bg-ink-900 text-sm font-medium text-canvas transition hover:bg-ink-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-500 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      type="submit"
      {...props}
    />
  );
}

function Attachments({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("flex flex-wrap gap-2", className)} {...props} />;
}

function Attachment({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cx(
        "flex items-center min-w-0 max-w-full py-1 rounded-full border-ink-200 bg-canvas pl-3 pr-1 border text-sm text-ink-900",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function AttachmentPreview({
  className,
  icon,
  ...props
}: ComponentProps<"div"> & { icon?: ReactNode }) {
  return (
    <div
      className={cx(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-700",
        className,
      )}
      {...props}
    >
      {icon}
    </div>
  );
}

function AttachmentInfo({
  className,
  title,
  subtitle,
  ...props
}: ComponentProps<"div"> & { title: string; subtitle?: string }) {
  return (
    <div className={cx("min-w-0", className)} {...props}>
      <p className="truncate font-medium text-ink-900">{title}</p>
    </div>
  );
}

function AttachmentRemove({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      className={cx(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-md text-ink-400 transition hover:bg-ink-100 hover:text-ink-700",
        className,
      )}
      type="button"
      {...props}
    >
      <XMarkIcon aria-hidden="true" className="size-4" />
    </button>
  );
}

function Reasoning({
  children,
  isStreaming,
  title = "Thinking",
}: {
  children: ReactNode;
  isStreaming: boolean;
  title?: ReactNode;
}) {
  return (
    <details
      className="group py-1 text-sm leading-6 text-ink-500"
      open={isStreaming}
    >
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 text-sm text-ink-400 [&::-webkit-details-marker]:hidden hover:text-ink-700 transition-all">
        <span className="min-w-0 truncate">
          {isStreaming && typeof title === "string" ? (
            <Shimmer
              as="span"
              className="inline-block max-w-full truncate align-bottom"
              duration={1.8}
            >
              {title}
            </Shimmer>
          ) : (
            title
          )}
        </span>
        <ChevronRightIcon
          aria-hidden="true"
          className="size-3.5 shrink-0 text-ink-400 transition group-open:rotate-90"
        />
      </summary>
      <div className="mt-3 border-l-2 border-ink-200/45 pl-4 text-sm leading-6 text-ink-400/50">
        <div className="[&_.prose]:text-sm [&_.prose]:leading-6 [&_.prose]:text-ink-400/50 [&_.prose-p]:my-1.5 [&_.prose-p]:text-ink-400/50 [&_.prose-li]:text-ink-400/50">
          {children}
        </div>
      </div>
    </details>
  );
}

function Tool({
  children,
  errorText,
  state,
  title,
}: {
  children?: ReactNode;
  errorText?: string;
  state: string;
  title: ReactNode;
}) {
  const tone = errorText
    ? "bg-red-500"
    : state === "output-available"
      ? "bg-emerald-500"
      : "bg-amber-400";
  const stateLabel = errorText
    ? "failed"
    : state === "output-available"
      ? "done"
      : "working";

  return (
    <div className="rounded-lg bg-surface text-sm text-ink-400">
      <div className="flex select-none items-center justify-between gap-2 text-ink-600">
        <span className="inline-flex min-w-0 items-center gap-2">
          <span
            aria-label={stateLabel}
            className={`size-2 shrink-0 rounded-full ${tone}`}
            title={stateLabel}
          />
          <WrenchScrewdriverIcon
            aria-hidden="true"
            className="size-3.5 shrink-0 text-ink-400"
          />
          <span className="truncate font-medium">{title}</span>
        </span>
      </div>
      {children ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}

export {
  Checkpoint,
  CheckpointIcon,
  CheckpointTrigger,
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  Message,
  MessageContent,
  MessageResponse,
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
  Reasoning,
  Tool,
  type ConversationContext,
};
