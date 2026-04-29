import { ArrowUpIcon } from "@heroicons/react/20/solid";
import type { KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import {
  SUBMIT_COMMENT_SHORTCUT,
  getShortcutAriaKeyShortcuts,
  isKeyboardShortcut,
} from "../../lib/keyboard-shortcuts";
import { KeyboardShortcut } from "./keyboard-shortcut";

type ReviewCommentMarkdownTextareaProps = {
  initialValue?: string;
  placeholder?: string;
  selectedLineLabel?: string;
  framed?: boolean;
  submitLabel: string;
  cancelLabel?: string;
  isPending?: boolean;
  error?: string;
  autoFocus?: boolean;
  onCancel?: () => void;
  onDirtyChange?: (isDirty: boolean) => void;
  onSubmit: (body: string) => Promise<void> | void;
};

function ReviewCommentMarkdownTextarea({
  initialValue = "",
  placeholder = "Leave a comment",
  selectedLineLabel,
  framed = true,
  submitLabel,
  cancelLabel = "Cancel",
  isPending = false,
  error = "",
  autoFocus = true,
  onCancel,
  onDirtyChange,
  onSubmit,
}: ReviewCommentMarkdownTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [body, setBody] = useState(initialValue);

  useEffect(() => {
    setBody(initialValue);
  }, [initialValue]);

  useEffect(() => {
    onDirtyChange?.(body !== initialValue);
  }, [body, initialValue, onDirtyChange]);

  useEffect(() => {
    if (!autoFocus) {
      return;
    }

    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const frameId = requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });

    return () => cancelAnimationFrame(frameId);
  }, [autoFocus]);

  async function handleSubmit() {
    if (isPending || !/\S/.test(body)) {
      return;
    }

    await onSubmit(body);
  }

  function handleTextareaKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!isKeyboardShortcut(event, SUBMIT_COMMENT_SHORTCUT)) {
      return;
    }

    event.preventDefault();
    void handleSubmit();
  }

  return (
    <div
      className={
        framed
          ? "rounded-lg border border-ink-200 bg-canvas p-3 shadow-sm font-sans"
          : "font-sans"
      }
    >
      {selectedLineLabel ? (
        <div className="mb-2 text-xs font-medium text-ink-500">
          {selectedLineLabel}
        </div>
      ) : null}
      <textarea
        ref={textareaRef}
        className="min-h-[96px] w-full resize-y rounded-lg bg-surface px-3 py-2 font-mono text-sm leading-6 text-ink-900 outline-none transition placeholder:text-ink-500"
        disabled={isPending}
        onChange={(event) => setBody(event.currentTarget.value)}
        onKeyDown={handleTextareaKeyDown}
        placeholder={placeholder}
        value={body}
      />
      {error ? (
        <div className="mt-2 text-sm text-danger-600">{error}</div>
      ) : null}
      <div className="mt-3 flex items-center gap-2">
        <button
          aria-keyshortcuts={getShortcutAriaKeyShortcuts(
            SUBMIT_COMMENT_SHORTCUT,
          )}
          className="flex items-center gap-1 rounded-md bg-ink-900 px-2 py-1 text-sm font-medium text-white transition hover:bg-ink-700 disabled:cursor-default disabled:opacity-60 dark:bg-ink-200 dark:text-ink-900 dark:hover:bg-ink-300"
          disabled={isPending || !/\S/.test(body)}
          onClick={() => void handleSubmit()}
          type="button"
        >
          <ArrowUpIcon className="size-4" />
          {isPending ? "Saving..." : submitLabel}
          <KeyboardShortcut
            className="ml-1 opacity-80"
            shortcut={SUBMIT_COMMENT_SHORTCUT}
          />
        </button>
        {onCancel ? (
          <button
            className="rounded-md px-2 py-1 text-sm text-ink-600 transition hover:bg-canvasDark hover:text-ink-900 disabled:cursor-default disabled:opacity-60"
            disabled={isPending}
            onClick={onCancel}
            type="button"
          >
            {cancelLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export { ReviewCommentMarkdownTextarea };
export type { ReviewCommentMarkdownTextareaProps };
