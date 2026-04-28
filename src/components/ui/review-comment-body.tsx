import type { CSSProperties } from "react";
import { processFile } from "@pierre/diffs";
import { FileDiff, VirtualizerContext } from "@pierre/diffs/react";
import { useDocumentDarkMode } from "../../hooks/use-document-dark-mode";
import { normalizeSeededCodeText } from "./review-comment-code-text";
import { CommentMarkdown } from "./comment-markdown";

type ReviewCommentBodyProps = {
  body: string;
  path: string;
  startLine: number | null;
  endLine: number | null;
  suggestionSeed?: string;
  suggestionLanguage?: string;
};

type CommentBodySegment =
  | {
      type: "markdown";
      body: string;
    }
  | {
      type: "suggestion";
      body: string;
    };

const DIFF_FONT_STYLE = {
  "--diffs-font-family":
    '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  "--diffs-header-font-family":
    '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
} as CSSProperties;

const DIFF_UNSAFE_CSS = `
  [data-gutter-utility-slot],
  [data-utility-button] {
    display: none !important;
    pointer-events: none !important;
  }

  [data-overflow='scroll'],
  [data-code] {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  [data-overflow='scroll']::-webkit-scrollbar,
  [data-code]::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
  }

  [data-code]::-webkit-scrollbar-track,
  [data-code]::-webkit-scrollbar-corner,
  [data-code]::-webkit-scrollbar-thumb,
  [data-diff]:hover [data-code]::-webkit-scrollbar-thumb,
  [data-file]:hover [data-code]::-webkit-scrollbar-thumb {
    background-color: transparent !important;
  }

  [data-column-number],
  [data-line] {
    cursor: default !important;
  }
`;

function normalizeNewlines(value: string) {
  return value.replace(/\r\n/g, "\n");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseCommentBodySegments(body: string): CommentBodySegment[] {
  const normalizedBody = normalizeNewlines(body);
  const lines = normalizedBody.split("\n");
  const segments: CommentBodySegment[] = [];
  const markdownBuffer: string[] = [];

  function flushMarkdown() {
    if (markdownBuffer.length === 0) {
      return;
    }

    const markdownBody = markdownBuffer.join("\n");
    markdownBuffer.length = 0;
    if (!markdownBody.trim()) {
      return;
    }

    segments.push({ type: "markdown", body: markdownBody });
  }

  for (let index = 0; index < lines.length; ) {
    const startMatch = lines[index]?.match(/^([ \t]*)(`{3,})suggestion[ \t]*$/);
    if (!startMatch) {
      markdownBuffer.push(lines[index] ?? "");
      index += 1;
      continue;
    }

    const startLine = lines[index] ?? "";
    const endPattern = new RegExp(
      `^${escapeRegExp(`${startMatch[1]}${startMatch[2]}`)}[ \\t]*$`,
    );
    const suggestionLines: string[] = [];
    let closingIndex = index + 1;

    while (
      closingIndex < lines.length &&
      !endPattern.test(lines[closingIndex] ?? "")
    ) {
      suggestionLines.push(lines[closingIndex] ?? "");
      closingIndex += 1;
    }

    if (closingIndex >= lines.length) {
      markdownBuffer.push(startLine, ...suggestionLines);
      break;
    }

    flushMarkdown();
    segments.push({
      type: "suggestion",
      body: suggestionLines.join("\n"),
    });
    index = closingIndex + 1;
  }

  flushMarkdown();
  return segments;
}

function buildSuggestionPatch(
  path: string,
  startLine: number,
  endLine: number,
  original: string,
  suggested: string,
) {
  const normalizedOriginal = normalizeSeededCodeText(original).replace(/\n$/, "");
  const normalizedSuggested = normalizeNewlines(suggested).replace(/\n$/, "");
  const originalLines =
    normalizedOriginal.length > 0 ? normalizedOriginal.split("\n") : [];
  const suggestedLines =
    normalizedSuggested.length > 0 ? normalizedSuggested.split("\n") : [];
  const firstLine = Math.min(startLine, endLine);

  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${firstLine},${originalLines.length} +${firstLine},${suggestedLines.length} @@`,
    ...originalLines.map((line) => `-${line}`),
    ...suggestedLines.map((line) => `+${line}`),
    "",
  ].join("\n");
}

function SuggestionDiff({
  path,
  startLine,
  endLine,
  original,
  suggested,
  suggestionLanguage,
}: {
  path: string;
  startLine: number;
  endLine: number;
  original: string;
  suggested: string;
  suggestionLanguage?: string;
}) {
  const isDark = useDocumentDarkMode();
  const fileDiff = processFile(
    buildSuggestionPatch(path, startLine, endLine, original, suggested),
    {
      throwOnError: false,
    },
  );

  if (!fileDiff) {
    return (
      <div className="my-3">
        <CommentMarkdown
          body={`\`\`\`${suggestionLanguage ?? ""}\n${suggested}\n\`\`\``}
        />
      </div>
    );
  }

  if (suggestionLanguage) {
    fileDiff.lang = suggestionLanguage;
  }

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-ink-200 bg-surface">
      <div className="border-b border-ink-200 bg-canvas px-3 py-2 text-xs font-sans font-medium text-ink-600">
        Suggested change
      </div>
      <VirtualizerContext.Provider value={undefined}>
        <FileDiff
          disableWorkerPool
          fileDiff={fileDiff}
          selectedLines={null}
          options={{
            theme: isDark ? "pierre-dark" : "pierre-light",
            themeType: isDark ? "dark" : "light",
            diffStyle: "unified",
            diffIndicators: "bars",
            disableFileHeader: true,
            disableVirtualizationBuffers: true,
            enableGutterUtility: false,
            enableLineSelection: false,
            lineDiffType: "word",
            lineHoverHighlight: "disabled",
            overflow: "scroll",
            unsafeCSS: DIFF_UNSAFE_CSS,
          }}
          style={DIFF_FONT_STYLE}
        />
      </VirtualizerContext.Provider>
    </div>
  );
}

function ReviewCommentBody({
  body,
  path,
  startLine,
  endLine,
  suggestionSeed,
  suggestionLanguage,
}: ReviewCommentBodyProps) {
  if (!suggestionSeed || startLine === null || endLine === null) {
    return <CommentMarkdown body={body} />;
  }

  const segments = parseCommentBodySegments(body);
  const hasSuggestionSegments = segments.some(
    (segment) => segment.type === "suggestion",
  );

  if (!hasSuggestionSegments) {
    return <CommentMarkdown body={body} />;
  }

  return (
    <div>
      {segments.map((segment, index) => {
        if (segment.type === "markdown") {
          return (
            <CommentMarkdown body={segment.body} key={`markdown-${index}`} />
          );
        }

        return (
          <SuggestionDiff
            endLine={endLine}
            key={`suggestion-${index}`}
            original={suggestionSeed}
            path={path}
            startLine={startLine}
            suggested={segment.body}
            suggestionLanguage={suggestionLanguage}
          />
        );
      })}
    </div>
  );
}

export { ReviewCommentBody, buildSuggestionPatch, parseCommentBodySegments };
export type { CommentBodySegment };
