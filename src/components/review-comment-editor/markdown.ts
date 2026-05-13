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
  type Transformer,
} from "@lexical/markdown";
import { LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import {
  $createCodeNode,
  $isCodeNode,
  CodeHighlightNode,
  CodeNode,
} from "@lexical/code";
import { normalizeCodeLanguage } from "@lexical/code-shiki";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import {
  $createTextNode,
  $getState,
  $setState,
  createEditor,
  createState,
} from "lexical";

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

const REVIEW_COMMENT_EDITOR_NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  CodeNode,
  CodeHighlightNode,
  LinkNode,
] as const;

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

function getReviewCommentMarkdownTransformers(
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

function loadReviewCommentMarkdown(
  markdown: string,
  transformers: ReadonlyArray<Transformer>,
) {
  $convertFromMarkdownString(markdown, [...transformers], undefined, true);
}

function readReviewCommentMarkdown(transformers: ReadonlyArray<Transformer>) {
  return $convertToMarkdownString([...transformers], undefined, true);
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

function roundTripReviewCommentMarkdown(
  markdown: string,
  {
    isDark = false,
    suggestionLanguage,
  }: {
    isDark?: boolean;
    suggestionLanguage?: string;
  } = {},
) {
  const normalizedSuggestionLanguage =
    normalizeSuggestedCodeLanguage(suggestionLanguage);
  const transformers = getReviewCommentMarkdownTransformers(
    normalizedSuggestionLanguage,
    getCodeThemeName(isDark),
  );
  const editor = createEditor({
    namespace: "review-comment-composer-roundtrip",
    nodes: [...REVIEW_COMMENT_EDITOR_NODES],
    onError(error) {
      throw error;
    },
    theme: {},
  });

  editor.update(() => {
    loadReviewCommentMarkdown(markdown, transformers);
  }, { discrete: true });

  let nextMarkdown = "";
  editor.getEditorState().read(() => {
    nextMarkdown = readReviewCommentMarkdown(transformers);
  });
  return nextMarkdown;
}

export {
  DARK_CODE_THEME,
  LIGHT_CODE_THEME,
  REVIEW_COMMENT_EDITOR_NODES,
  SUPPORTED_CODE_LANGUAGES,
  getCodeThemeName,
  getReviewCommentMarkdownTransformers,
  inferCodeLanguageFromPath,
  loadReviewCommentMarkdown,
  normalizeEditorMarkdown,
  normalizeSuggestedCodeLanguage,
  readReviewCommentMarkdown,
  requiresRawMarkdownEditor,
  roundTripReviewCommentMarkdown,
  suggestionBlockState,
};
