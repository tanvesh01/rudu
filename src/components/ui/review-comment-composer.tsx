import {
  ArrowUpIcon,
  CodeBracketIcon,
  LinkIcon,
  ListBulletIcon,
  NumberedListIcon,
  StrikethroughIcon,
  BoldIcon,
  ItalicIcon,
} from "@heroicons/react/20/solid";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin";
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from "@lexical/list";
import {
  loadCodeLanguage,
  loadCodeTheme,
  normalizeCodeLanguage,
  registerCodeHighlighting,
  ShikiTokenizer,
} from "@lexical/code-shiki";
import { CodeNode } from "@lexical/code";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import {
  $getSelection,
  $isRangeSelection,
  $nodesOfType,
  FORMAT_TEXT_COMMAND,
} from "lexical";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useDocumentDarkMode } from "../../hooks/use-document-dark-mode";
import {
  SUBMIT_COMMENT_SHORTCUT,
  getShortcutAriaKeyShortcuts,
  isKeyboardShortcut,
} from "../../lib/keyboard-shortcuts";
import MaterialSymbolsFormatQuote from "../../assets/icons/MaterialSymbolsFormatQuote";
import LucideListTodo from "../../assets/icons/LucideListTodo";
import LineMdFileDocumentPlusTwotone from "../../assets/icons/LineMdFileDocumentPlusTwotone";
import MajesticonsCodeBlockLine from "../../assets/icons/MajesticonsCodeBlockLine";
import TablerHeading from "../../assets/icons/TablerHeading";
import {
  getCodeThemeName,
  getReviewCommentMarkdownTransformers,
  inferCodeLanguageFromPath,
  loadReviewCommentMarkdown,
  normalizeEditorMarkdown,
  normalizeSuggestedCodeLanguage,
  readReviewCommentMarkdown,
  requiresRawMarkdownEditor,
  REVIEW_COMMENT_EDITOR_NODES,
  SUPPORTED_CODE_LANGUAGES,
} from "../review-comment-editor/markdown";
import {
  insertCodeBlock,
  insertSuggestionBlock,
  setBlockType,
} from "../review-comment-editor/commands";
import { KeyboardShortcut } from "./keyboard-shortcut";
import { Tooltip, TooltipProvider } from "./tooltip";

type ReviewCommentComposerProps = {
  initialValue?: string;
  placeholder?: string;
  selectedLineLabel?: string;
  allowSuggestion?: boolean;
  suggestionSeed?: string;
  suggestionLanguage?: string;
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

const EDITOR_THEME = {
  code: "review-comment-composer-code my-3 block w-full overflow-x-auto whitespace-pre rounded-lg border border-ink-200 bg-canvas px-3 py-2 font-mono text-sm leading-6 text-ink-900 shadow-sm first:mt-0 last:mb-0",
  heading: {
    h1: "text-xl font-semibold text-ink-900",
    h2: "text-lg font-semibold text-ink-900",
    h3: "text-base font-semibold text-ink-900",
    h4: "text-sm font-semibold text-ink-900",
    h5: "text-sm font-semibold text-ink-900",
    h6: "text-sm font-semibold text-ink-900",
  },
  link: "text-ink-700 underline underline-offset-2",
  list: {
    checklist: "my-2 ml-0 list-none pl-0",
    listitem: "my-1 leading-6 text-ink-800 marker:text-ink-400",
    listitemChecked:
      "relative list-none pl-7 text-ink-700 cursor-pointer before:absolute before:left-0 before:top-[0.3rem] before:flex before:size-4 before:items-center before:justify-center before:rounded before:border before:border-emerald-500 before:bg-emerald-50 before:text-[10px] before:font-bold before:text-emerald-700 before:content-['✓']",
    listitemUnchecked:
      "relative list-none pl-7 text-ink-800 cursor-pointer before:absolute before:left-0 before:top-[0.3rem] before:block before:size-4 before:rounded before:border before:border-ink-300 before:bg-canvas before:content-['']",
    nested: {
      listitem: "my-1",
    },
    ol: "my-2 ml-5 list-decimal",
    ul: "my-2 ml-5 list-disc",
  },
  paragraph: "my-2 leading-6 text-ink-800 first:mt-0 last:mb-0",
  quote: "m-0 border-l-2 border-ink-200 pl-3 text-ink-600",
  text: {
    bold: "font-semibold",
    code: "rounded bg-canvas px-1 py-0.5 font-mono text-[0.92em] text-ink-900",
    italic: "italic",
    strikethrough: "line-through",
  },
};

function ToolbarButton({
  children,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label}>
      <button
        aria-label={label}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-500 transition hover:bg-canvasDark hover:text-ink-900 disabled:cursor-default disabled:opacity-50"
        disabled={disabled}
        onClick={onClick}
        type="button"
      >
        {children}
      </button>
    </Tooltip>
  );
}

function Toolbar({
  allowSuggestion,
  codeTheme,
  disabled,
  suggestionLanguage,
  suggestionSeed,
}: {
  allowSuggestion: boolean;
  disabled: boolean;
  suggestionLanguage: string;
  codeTheme: string;
  suggestionSeed?: string;
}) {
  const [editor] = useLexicalComposerContext();

  return (
    <TooltipProvider>
      <div className="mb-1 flex flex-wrap items-center">
        <ToolbarButton
          disabled={disabled}
          label="Bold"
          onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}
        >
          <BoldIcon className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          disabled={disabled}
          label="Italic"
          onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")}
        >
          <ItalicIcon className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          disabled={disabled}
          label="Strikethrough"
          onClick={() =>
            editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough")
          }
        >
          <StrikethroughIcon className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          disabled={disabled}
          label="Inline code"
          onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "code")}
        >
          <CodeBracketIcon className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          disabled={disabled}
          label="Code block"
          onClick={() => insertCodeBlock(editor, "", codeTheme)}
        >
          <MajesticonsCodeBlockLine className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          disabled={disabled}
          label="Quote"
          onClick={() => setBlockType(editor, () => $createQuoteNode())}
        >
          <MaterialSymbolsFormatQuote className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          disabled={disabled}
          label="Bullet list"
          onClick={() =>
            editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)
          }
        >
          <ListBulletIcon className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          disabled={disabled}
          label="Numbered list"
          onClick={() =>
            editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)
          }
        >
          <NumberedListIcon className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          disabled={disabled}
          label="Task list"
          onClick={() =>
            editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined)
          }
        >
          <LucideListTodo className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          disabled={disabled}
          label="Heading"
          onClick={() => setBlockType(editor, () => $createHeadingNode("h3"))}
        >
          <TablerHeading className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          disabled={disabled}
          label="Markdown link"
          onClick={() => {
            editor.update(() => {
              const selection = $getSelection();
              if (!$isRangeSelection(selection)) {
                return;
              }

              const selectedText = selection.getTextContent();
              const template =
                selectedText.length > 0
                  ? `[${selectedText}](https://example.com)`
                  : `[link text](https://example.com)`;
              selection.insertRawText(template);
            });
          }}
        >
          <LinkIcon className="size-4" />
        </ToolbarButton>
        {allowSuggestion ? (
          <ToolbarButton
            disabled={disabled}
            label="Add a suggestion"
            onClick={() =>
              insertSuggestionBlock(
                editor,
                suggestionLanguage,
                codeTheme,
                suggestionSeed ?? "replace with suggested code",
              )
            }
          >
            <LineMdFileDocumentPlusTwotone className="size-4 text-black dark:text-white fill-none" />
          </ToolbarButton>
        ) : null}
      </div>
    </TooltipProvider>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="pointer-events-none absolute left-3 top-2.5 text-sm text-ink-500">
      {text}
    </div>
  );
}

function ShikiPlugin() {
  const [editor] = useLexicalComposerContext();
  const isDark = useDocumentDarkMode();
  const codeTheme = getCodeThemeName(isDark);

  useEffect(() => {
    const unregister = registerCodeHighlighting(editor, ShikiTokenizer);
    return unregister;
  }, [editor]);

  useEffect(() => {
    void loadCodeTheme(codeTheme);

    const languages = new Set<string>();
    for (const language of SUPPORTED_CODE_LANGUAGES) {
      languages.add(language);
      languages.add(normalizeCodeLanguage(language));
    }

    for (const language of languages) {
      void loadCodeLanguage(language, editor);
    }

    editor.update(() => {
      for (const codeNode of $nodesOfType(CodeNode)) {
        if (codeNode.getTheme() !== codeTheme) {
          codeNode.setTheme(codeTheme);
        }
      }
    });
  }, [codeTheme, editor]);

  return null;
}

function ReviewCommentComposer({
  initialValue = "",
  placeholder = "Leave a comment",
  selectedLineLabel,
  allowSuggestion = false,
  suggestionSeed,
  suggestionLanguage,
  framed = true,
  submitLabel,
  cancelLabel = "Cancel",
  isPending = false,
  error = "",
  autoFocus = true,
  onCancel,
  onDirtyChange,
  onSubmit,
}: ReviewCommentComposerProps) {
  const [currentMarkdown, setCurrentMarkdown] = useState(initialValue);
  const initialMarkdownRef = useRef(initialValue);
  const isDark = useDocumentDarkMode();
  const normalizedSuggestionLanguage =
    normalizeSuggestedCodeLanguage(suggestionLanguage);
  const codeTheme = getCodeThemeName(isDark);
  const markdownTransformers = getReviewCommentMarkdownTransformers(
    normalizedSuggestionLanguage,
    codeTheme,
  );

  useEffect(() => {
    setCurrentMarkdown(initialValue);
    initialMarkdownRef.current = initialValue;
  }, [initialValue]);

  useEffect(() => {
    onDirtyChange?.(
      normalizeEditorMarkdown(currentMarkdown) !==
        normalizeEditorMarkdown(initialMarkdownRef.current),
    );
  }, [currentMarkdown, onDirtyChange]);

  async function handleSubmit() {
    if (isPending || !/\S/.test(currentMarkdown)) {
      return;
    }

    await onSubmit(currentMarkdown);
  }

  return (
    <div
      className={
        framed
          ? "rounded-lg border border-ink-200 bg-canvas p-3 shadow-sm font-sans"
          : "font-sans"
      }
      onKeyDownCapture={(event) => {
        if (isKeyboardShortcut(event, SUBMIT_COMMENT_SHORTCUT)) {
          event.preventDefault();
          void handleSubmit();
          return;
        }

        if (event.key === "Escape" && onCancel) {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      {selectedLineLabel ? (
        <div className="mb-2 text-xs font-medium text-ink-500">
          {selectedLineLabel}
        </div>
      ) : null}
      <LexicalComposer
        initialConfig={{
          namespace: "review-comment-composer",
          nodes: [...REVIEW_COMMENT_EDITOR_NODES],
          onError(lexicalError) {
            throw lexicalError;
          },
          editorState() {
            loadReviewCommentMarkdown(initialValue, markdownTransformers);
          },
          theme: EDITOR_THEME,
        }}
      >
        <Toolbar
          allowSuggestion={allowSuggestion}
          codeTheme={codeTheme}
          disabled={isPending}
          suggestionLanguage={normalizedSuggestionLanguage}
          suggestionSeed={suggestionSeed}
        />
        <div className="relative rounded-lg bg-surface px-3 py-2 transition focus-within:border-ink-400">
          <RichTextPlugin
            ErrorBoundary={LexicalErrorBoundary}
            contentEditable={
              <ContentEditable
                aria-label={placeholder}
                className="min-h-[96px] max-h-[320px] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 text-ink-900 outline-none [tab-size:2] [&_li[role='checkbox']]:select-none [&_pre]:my-3 [&_pre]:overflow-x-auto"
                spellCheck={false}
              />
            }
            placeholder={<Placeholder text={placeholder} />}
          />
        </div>
        <HistoryPlugin />
        <ListPlugin />
        <CheckListPlugin />
        <LinkPlugin />
        <TabIndentationPlugin maxIndent={7} />
        <MarkdownShortcutPlugin transformers={[...markdownTransformers]} />
        <OnChangePlugin
          ignoreHistoryMergeTagChange={false}
          ignoreSelectionChange
          onChange={(editorState) => {
            editorState.read(() => {
              setCurrentMarkdown(readReviewCommentMarkdown(markdownTransformers));
            });
          }}
        />
        <ShikiPlugin />
        {autoFocus ? <AutoFocusPlugin /> : null}
      </LexicalComposer>
      {error ? (
        <div className="mt-2 text-sm text-danger-600">{error}</div>
      ) : null}
      <div className="mt-3 flex items-center gap-2">
        <button
          aria-keyshortcuts={getShortcutAriaKeyShortcuts(
            SUBMIT_COMMENT_SHORTCUT,
          )}
          className="flex items-center gap-1 rounded-md bg-ink-900 px-2 py-1 text-sm font-medium text-white transition hover:bg-ink-700 disabled:cursor-default disabled:opacity-60 dark:bg-ink-200 dark:text-ink-900 dark:hover:bg-ink-300"
          disabled={isPending || !/\S/.test(currentMarkdown)}
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

export {
  ReviewCommentComposer,
  inferCodeLanguageFromPath,
  normalizeEditorMarkdown,
  requiresRawMarkdownEditor,
};
export type { ReviewCommentComposerProps };
