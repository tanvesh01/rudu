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
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  CHECK_LIST,
  CODE,
  $convertFromMarkdownString,
  $convertToMarkdownString,
  HEADING,
  INLINE_CODE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  LINK,
  ORDERED_LIST,
  QUOTE,
  STRIKETHROUGH,
  UNORDERED_LIST,
  type MultilineElementTransformer,
} from "@lexical/markdown";
import { LinkNode } from "@lexical/link";
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
} from "@lexical/list";
import {
  $createCodeNode,
  $isCodeNode,
  CodeHighlightNode,
  CodeNode,
} from "@lexical/code";
import {
  loadCodeLanguage,
  loadCodeTheme,
  normalizeCodeLanguage,
  registerCodeHighlighting,
  ShikiTokenizer,
} from "@lexical/code-shiki";
import {
  HeadingNode,
  QuoteNode,
  $createHeadingNode,
  $createQuoteNode,
} from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTabNode,
  $createTextNode,
  $getState,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $nodesOfType,
  $setState,
  createState,
  FORMAT_TEXT_COMMAND,
  type LexicalEditor,
} from "lexical";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useDocumentDarkMode } from "../../hooks/use-document-dark-mode";
import MaterialSymbolsFormatQuote from "../../assets/icons/MaterialSymbolsFormatQuote";
import LucideListTodo from "../../assets/icons/LucideListTodo";
import LineMdFileDocumentPlusTwotone from "../../assets/icons/LineMdFileDocumentPlusTwotone";
import MajesticonsCodeBlockLine from "../../assets/icons/MajesticonsCodeBlockLine";
import TablerHeading from "../../assets/icons/TablerHeading";
import { normalizeSeededCodeText } from "./review-comment-code-text";
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

const SUPPORTED_CODE_LANGUAGES = [
  "text",
  "markdown",
  "javascript",
  "jsx",
  "typescript",
  "tsx",
  "json",
  "shellscript",
  "rust",
  "diff",
  "python",
] as const;

const LIGHT_CODE_THEME = "github-light";
const DARK_CODE_THEME = "github-dark";

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

const suggestionBlockState = createState("reviewCommentSuggestionBlock", {
  parse: (value) => value === true,
});

const reviewCommentCodeFenceState = createState("reviewCommentCodeFence", {
  parse: (value) =>
    typeof value === "string" && value.length > 0 ? value : "```",
});

function normalizeSuggestedCodeLanguage(language: string | undefined) {
  if (!language) {
    return "text";
  }

  const normalized = normalizeCodeLanguage(language.toLowerCase());
  return SUPPORTED_CODE_LANGUAGES.includes(
    normalized as (typeof SUPPORTED_CODE_LANGUAGES)[number],
  )
    ? normalized
    : "text";
}

function inferCodeLanguageFromPath(path: string) {
  const normalizedPath = path.toLowerCase();

  if (normalizedPath.endsWith(".tsx")) return "tsx";
  if (normalizedPath.endsWith(".ts")) return "typescript";
  if (normalizedPath.endsWith(".jsx")) return "jsx";
  if (
    normalizedPath.endsWith(".js") ||
    normalizedPath.endsWith(".mjs") ||
    normalizedPath.endsWith(".cjs")
  ) {
    return "javascript";
  }
  if (normalizedPath.endsWith(".py")) return "python";
  if (normalizedPath.endsWith(".rs")) return "rust";
  if (
    normalizedPath.endsWith(".sh") ||
    normalizedPath.endsWith(".bash") ||
    normalizedPath.endsWith(".zsh")
  ) {
    return "shellscript";
  }
  if (normalizedPath.endsWith(".json")) return "json";
  if (
    normalizedPath.endsWith(".md") ||
    normalizedPath.endsWith(".mdx") ||
    normalizedPath.endsWith(".markdown")
  ) {
    return "markdown";
  }
  if (normalizedPath.endsWith(".diff") || normalizedPath.endsWith(".patch")) {
    return "diff";
  }

  return "text";
}

function getCodeThemeName(isDark: boolean) {
  return isDark ? DARK_CODE_THEME : LIGHT_CODE_THEME;
}

function createSuggestionTransformer(
  defaultLanguage: string,
  codeTheme: string,
) {
  const regExpStart = /^([ \t]*`{3,})(suggestion)?[ \t]?/;
  const regExpEnd = {
    optional: true as const,
    regExp: /^[ \t]*`{3,}$/,
  };

  const suggestionTransformer: MultilineElementTransformer = {
    dependencies: [CodeNode],
    export(node) {
      if (!$isCodeNode(node) || !$getState(node, suggestionBlockState)) {
        return null;
      }

      const textContent = node.getTextContent();
      let fence = $getState(node, reviewCommentCodeFenceState);
      if (textContent.indexOf(fence) > -1) {
        const backticks = textContent.match(/`{3,}/g);
        if (backticks) {
          const maxLength = Math.max(...backticks.map((value) => value.length));
          fence = "`".repeat(maxLength + 1);
        }
      }

      return `${fence}suggestion${textContent ? `\n${textContent}` : ""}\n${fence}`;
    },
    handleImportAfterStartMatch({
      lines,
      rootNode,
      startLineIndex,
      startMatch,
    }) {
      if (startMatch[2] !== "suggestion") {
        return null;
      }

      const fence = startMatch[1];
      const fenceLength = fence.trim().length;
      const currentLine = lines[startLineIndex];
      const afterFenceIndex = (startMatch.index ?? 0) + startMatch[0].length;
      const afterFence = currentLine.slice(afterFenceIndex);
      const singleLineEndRegex = new RegExp(`\`{${fenceLength},}$`);
      if (singleLineEndRegex.test(afterFence)) {
        const endMatch = afterFence.match(singleLineEndRegex);
        const content = afterFence.slice(
          0,
          afterFence.lastIndexOf(endMatch?.[0] ?? ""),
        );
        suggestionTransformer.replace(
          rootNode,
          null,
          startMatch,
          endMatch,
          [content],
          true,
        );
        return [true, startLineIndex];
      }

      const multilineEndRegex = new RegExp(`^[ \\t]*\`{${fenceLength},}$`);
      for (let index = startLineIndex + 1; index < lines.length; index += 1) {
        const line = lines[index];
        if (!multilineEndRegex.test(line)) {
          continue;
        }

        const endMatch = line.match(multilineEndRegex);
        const linesInBetween = lines.slice(startLineIndex + 1, index);
        const afterFullMatch = currentLine.slice(startMatch[0].length);
        if (afterFullMatch.length > 0) {
          linesInBetween.unshift(afterFullMatch);
        }
        suggestionTransformer.replace(
          rootNode,
          null,
          startMatch,
          endMatch,
          linesInBetween,
          true,
        );
        return [true, index];
      }

      const linesInBetween = lines.slice(startLineIndex + 1);
      const afterFullMatch = currentLine.slice(startMatch[0].length);
      if (afterFullMatch.length > 0) {
        linesInBetween.unshift(afterFullMatch);
      }
      suggestionTransformer.replace(
        rootNode,
        null,
        startMatch,
        null,
        linesInBetween,
        true,
      );
      return [true, lines.length - 1];
    },
    regExpEnd,
    regExpStart,
    replace(
      rootNode,
      children,
      startMatch,
      endMatch,
      linesInBetween,
      isImport,
    ) {
      if (startMatch[2] !== "suggestion") {
        return false;
      }

      const fence = startMatch[1] ? startMatch[1].trim() : "```";

      if (!children && linesInBetween) {
        const codeBlockNode = $createCodeNode(defaultLanguage);
        codeBlockNode.setTheme(codeTheme);
        let code = "";

        if (linesInBetween.length === 1) {
          code = endMatch
            ? linesInBetween[0]
            : linesInBetween[0].startsWith(" ")
              ? linesInBetween[0].slice(1)
              : linesInBetween[0];
        } else {
          const normalizedLines = [...linesInBetween];
          if (normalizedLines.length > 0) {
            if (normalizedLines[0].trim().length === 0) {
              normalizedLines.shift();
            } else if (normalizedLines[0].startsWith(" ")) {
              normalizedLines[0] = normalizedLines[0].slice(1);
            }
          }
          while (
            normalizedLines.length > 0 &&
            !normalizedLines[normalizedLines.length - 1].length
          ) {
            normalizedLines.pop();
          }
          code = normalizedLines.join("\n");
        }

        $setState(codeBlockNode, reviewCommentCodeFenceState, fence);
        $setState(codeBlockNode, suggestionBlockState, true);
        codeBlockNode.append($createTextNode(code));
        rootNode.append(codeBlockNode);
        return;
      }

      if (children) {
        const codeBlockNode = $createCodeNode(defaultLanguage);
        codeBlockNode.setTheme(codeTheme);
        $setState(codeBlockNode, reviewCommentCodeFenceState, fence);
        $setState(codeBlockNode, suggestionBlockState, true);
        codeBlockNode.append(...children);

        if (isImport) {
          rootNode.append(codeBlockNode);
        } else {
          rootNode.replace(codeBlockNode);
          codeBlockNode.select(0, 0);
        }
      }
    },
    type: "multiline-element" as const,
  };

  return suggestionTransformer;
}

function getMarkdownTransformers(
  suggestionLanguage: string,
  codeTheme: string,
) {
  return [
    createSuggestionTransformer(suggestionLanguage, codeTheme),
    HEADING,
    QUOTE,
    UNORDERED_LIST,
    ORDERED_LIST,
    CHECK_LIST,
    CODE,
    LINK,
    INLINE_CODE,
    STRIKETHROUGH,
    BOLD_ITALIC_STAR,
    BOLD_ITALIC_UNDERSCORE,
    BOLD_STAR,
    BOLD_UNDERSCORE,
    ITALIC_STAR,
    ITALIC_UNDERSCORE,
  ] as const;
}

function normalizeEditorMarkdown(markdown: string) {
  return markdown.replace(/\r\n/g, "\n").replace(/\n$/, "");
}

function requiresRawMarkdownEditor(markdown: string) {
  return (
    /^ *\|.+\| *$/m.test(markdown) ||
    /^ *\|(?: *[-:]+[-| :]*)\| *$/m.test(markdown) ||
    /!\[[^\]]*]\([^)]+\)/.test(markdown) ||
    /<details[\s>]/i.test(markdown) ||
    /<summary[\s>]/i.test(markdown) ||
    /<\/?[a-z][^>]*>/i.test(markdown) ||
    /\[\^[^\]]+]/.test(markdown) ||
    /^\[\^[^\]]+]:/m.test(markdown) ||
    /^\$\$/m.test(markdown) ||
    /^```(?:mermaid|math)/m.test(markdown)
  );
}

function appendCodeText(codeNode: CodeNode, text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const segments = lines[index].split("\t");
    for (
      let segmentIndex = 0;
      segmentIndex < segments.length;
      segmentIndex += 1
    ) {
      const segment = segments[segmentIndex];
      if (segment.length > 0) {
        codeNode.append($createTextNode(segment));
      }
      if (segmentIndex < segments.length - 1) {
        codeNode.append($createTabNode());
      }
    }

    if (index < lines.length - 1) {
      codeNode.append($createLineBreakNode());
    }
  }
}

function insertCodeBlock(
  editor: LexicalEditor,
  language: string,
  codeTheme: string,
  emptyPlaceholder?: string,
) {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) {
      return;
    }

    const selectedText = selection.getTextContent();
    const codeNode = $createCodeNode(language);
    codeNode.setTheme(codeTheme);
    if (selectedText.length > 0) {
      appendCodeText(codeNode, normalizeSeededCodeText(selectedText));
    } else if (emptyPlaceholder && emptyPlaceholder.length > 0) {
      appendCodeText(codeNode, normalizeSeededCodeText(emptyPlaceholder));
    } else {
      codeNode.append($createTextNode(""));
    }

    const trailingParagraph = $createParagraphNode();
    selection.insertNodes([codeNode, trailingParagraph]);

    if (selectedText.length > 0) {
      trailingParagraph.selectStart();
      return;
    }

    const firstChild = codeNode.getFirstChild();
    if ($isTextNode(firstChild)) {
      const length = firstChild.getTextContentSize();
      firstChild.select(0, length);
    } else {
      codeNode.selectStart();
    }
  });
}

function insertSuggestionBlock(
  editor: LexicalEditor,
  language: string,
  codeTheme: string,
  emptyPlaceholder?: string,
) {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) {
      return;
    }

    const selectedText = selection.getTextContent();
    const codeNode = $createCodeNode(language);
    codeNode.setTheme(codeTheme);
    $setState(codeNode, suggestionBlockState, true);

    if (selectedText.length > 0) {
      appendCodeText(codeNode, normalizeSeededCodeText(selectedText));
    } else if (emptyPlaceholder && emptyPlaceholder.length > 0) {
      appendCodeText(codeNode, normalizeSeededCodeText(emptyPlaceholder));
    } else {
      codeNode.append($createTextNode(""));
    }

    const trailingParagraph = $createParagraphNode();
    selection.insertNodes([codeNode, trailingParagraph]);

    if (selectedText.length > 0) {
      trailingParagraph.selectStart();
      return;
    }

    const firstChild = codeNode.getFirstChild();
    if ($isTextNode(firstChild)) {
      const length = firstChild.getTextContentSize();
      firstChild.select(0, length);
    } else {
      codeNode.selectStart();
    }
  });
}

function setBlockType(
  editor: LexicalEditor,
  factory: () => HeadingNode | QuoteNode,
) {
  editor.update(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      $setBlocksType(selection, factory);
    }
  });
}

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
  const markdownTransformers = getMarkdownTransformers(
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
    if (!/\S/.test(currentMarkdown)) {
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
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
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
          nodes: [
            HeadingNode,
            QuoteNode,
            ListNode,
            ListItemNode,
            CodeNode,
            CodeHighlightNode,
            LinkNode,
          ],
          onError(lexicalError) {
            throw lexicalError;
          },
          editorState() {
            $convertFromMarkdownString(
              initialValue,
              [...markdownTransformers],
              undefined,
              true,
            );
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
              setCurrentMarkdown(
                $convertToMarkdownString(
                  [...markdownTransformers],
                  undefined,
                  true,
                ),
              );
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
          className="flex items-center gap-1 rounded-md bg-ink-900 px-2 py-1 text-sm font-medium text-white transition hover:bg-ink-700 disabled:cursor-default disabled:opacity-60 dark:bg-ink-200 dark:text-ink-900 dark:hover:bg-ink-300"
          disabled={isPending || !/\S/.test(currentMarkdown)}
          onClick={() => void handleSubmit()}
          type="button"
        >
          <ArrowUpIcon className="size-4" />
          {isPending ? "Saving..." : submitLabel}
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
