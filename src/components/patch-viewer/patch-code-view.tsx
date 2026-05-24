import { memo, useCallback, useMemo } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import type {
  CodeViewItem,
  DiffLineAnnotation,
  SelectedLineRange,
} from "@pierre/diffs";
import type { CodeViewHandle, CodeViewProps } from "@pierre/diffs/react";
import { CodeView } from "@pierre/diffs/react";
import {
  normalizePath,
  type FileReviewThreads,
} from "../../lib/review-threads";
import type { ReviewCommentSide } from "../../types/github";
import type { ReviewChatAttachment } from "../../features/review-chat/selection/line-selection";
import type { PatchViewFile } from "./patch-view-model";
import type { DraftReviewCommentTarget } from "./review-composer-state";

type DraftReviewCommentAnnotation = {
  kind: "draft";
};

type PatchLineAnnotation =
  | FileReviewThreads["lineAnnotations"][number]["metadata"]
  | DraftReviewCommentAnnotation;

type PatchCodeViewProps = {
  codeViewRef: RefObject<CodeViewHandle<PatchLineAnnotation> | null>;
  draftChatAttachments: ReviewChatAttachment[];
  draftCommentTarget: DraftReviewCommentTarget | null;
  files: PatchViewFile[];
  onOpenLineCommentDraft: (path: string, range: SelectedLineRange) => void;
  renderReviewThreadAnnotations: (
    annotation: DiffLineAnnotation<PatchLineAnnotation>,
  ) => ReactNode;
};

const VIRTUAL_FILE_METRICS = {
  hunkLineCount: 50,
  lineHeight: 20,
  diffHeaderHeight: 44,
  hunkSeparatorHeight: 32,
  spacing: 8,
};

const DIFF_FONT_STYLE = {
  "--diffs-font-family":
    '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  "--diffs-header-font-family":
    '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
} as CSSProperties;

const DIFF_THEME = {
  dark: "pierre-dark",
  light: "pierre-light",
} as const;

const DIFF_UNSAFE_CSS = `
  [data-overflow='scroll'],
  [data-code] {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  [data-code] {
    padding-bottom: var(--diffs-gap-block, var(--diffs-gap-fallback));
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

  [data-column-number][data-selected-line]::before {
    background-color: #f59e0b;
    background-image: none;
  }
`;

const CODE_VIEW_BASE_OPTIONS = {
  theme: DIFF_THEME,
  diffStyle: "unified",
  diffIndicators: "bars",
  lineDiffType: "word",
  overflow: "scroll",
  unsafeCSS: DIFF_UNSAFE_CSS,
  enableGutterUtility: true,
  enableLineSelection: true,
  itemMetrics: VIRTUAL_FILE_METRICS,
  layout: {
    paddingTop: 0,
    paddingBottom: 0,
    gap: 0,
  },
  stickyHeaders: true,
} satisfies NonNullable<CodeViewProps<PatchLineAnnotation>["options"]>;

function cx(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(" ");
}

function toSelectionSide(side: ReviewCommentSide | null | undefined) {
  return side === "LEFT" ? "deletions" : "additions";
}

function getLineDraftRange(
  target: Extract<DraftReviewCommentTarget, { type: "line" }>,
): SelectedLineRange {
  return {
    start: target.startLine ?? target.line,
    side: toSelectionSide(target.startSide ?? target.side),
    end: target.line,
    endSide: toSelectionSide(target.side),
  };
}

function getCodeViewItemId(path: string) {
  return normalizePath(path);
}

function hashVersion(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return hash;
}

function buildAnnotationSignature(fileReviewThreads: FileReviewThreads) {
  return fileReviewThreads.lineAnnotations
    .map(({ lineNumber, metadata, side }) => {
      const { thread } = metadata;
      const commentsSignature = thread.comments
        .map(
          (comment) =>
            `${comment.id}:${comment.updatedAt}:${comment.replyToId ?? "root"}:${comment.isPending ? "pending" : "ready"}`,
        )
        .join(",");

      return [
        thread.id,
        side,
        lineNumber,
        thread.line ?? "none",
        thread.startLine ?? "none",
        thread.isResolved ? "resolved" : "open",
        thread.isOutdated ? "outdated" : "current",
        commentsSignature,
      ].join("|");
    })
    .join(";");
}

function buildCodeViewVersion(file: PatchViewFile) {
  const draftSignature = file.lineDraft
    ? [
        file.lineDraft.line,
        file.lineDraft.side,
        file.lineDraft.startLine ?? "none",
        file.lineDraft.startSide ?? "none",
      ].join(":")
    : "none";

  return hashVersion(
    [
      file.fileDiff.cacheKey ?? file.fileDiff.name,
      file.fileDiff.additionLines.length,
      file.fileDiff.deletionLines.length,
      buildAnnotationSignature(file.fileReviewThreads),
      draftSignature,
    ].join("::"),
  );
}

function buildLineAnnotations(file: PatchViewFile) {
  if (!file.lineDraft) {
    return file.fileReviewThreads.lineAnnotations;
  }

  return [
    ...file.fileReviewThreads.lineAnnotations,
    {
      side: toSelectionSide(file.lineDraft.side),
      lineNumber: file.lineDraft.line,
      metadata: { kind: "draft" },
    } satisfies DiffLineAnnotation<PatchLineAnnotation>,
  ];
}

function ReviewThreadSummary({
  fileReviewThreads,
}: {
  fileReviewThreads: FileReviewThreads;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-ink-500">
      {fileReviewThreads.totalCount > 0 ? (
        <span className="rounded-full bg-canvas px-2 py-0.5 text-ink-700">
          {fileReviewThreads.totalCount} threads
        </span>
      ) : null}
      {fileReviewThreads.totalCount > 0 ? (
        <span
          className={cx(
            "rounded-full px-2 py-0.5",
            fileReviewThreads.unresolvedCount > 0
              ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
              : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
          )}
        >
          {fileReviewThreads.unresolvedCount > 0
            ? `${fileReviewThreads.unresolvedCount} open`
            : "All resolved"}
        </span>
      ) : null}
      {fileReviewThreads.fileThreads.length > 0 ? (
        <span className="text-ink-500">
          {fileReviewThreads.fileThreads.length} file-level
        </span>
      ) : null}
    </div>
  );
}

function getSelectedCodeViewLines({
  draftChatAttachments,
  draftCommentTarget,
  files,
}: Pick<
  PatchCodeViewProps,
  "draftChatAttachments" | "draftCommentTarget" | "files"
>) {
  if (draftCommentTarget?.type === "line") {
    return {
      id: getCodeViewItemId(draftCommentTarget.path),
      range: getLineDraftRange(draftCommentTarget),
    };
  }

  for (const attachment of draftChatAttachments) {
    if (attachment.kind !== "diff-lines") continue;

    const hasFile = files.some(
      (file) =>
        normalizePath(file.fileDiff.name) === normalizePath(attachment.path),
    );
    if (!hasFile) continue;

    return {
      id: getCodeViewItemId(attachment.path),
      range: {
        start: attachment.startLine,
        side: attachment.startSide,
        end: attachment.endLine,
        endSide: attachment.endSide,
      },
    };
  }

  return null;
}

function PatchCodeView({
  codeViewRef,
  draftChatAttachments,
  draftCommentTarget,
  files,
  onOpenLineCommentDraft,
  renderReviewThreadAnnotations,
}: PatchCodeViewProps) {
  const fileByItemId = useMemo(
    () =>
      new Map(
        files.map((file) => [getCodeViewItemId(file.fileDiff.name), file]),
      ),
    [files],
  );
  const items = useMemo<CodeViewItem<PatchLineAnnotation>[]>(
    () =>
      files.map((file) => ({
        id: getCodeViewItemId(file.fileDiff.name),
        type: "diff",
        fileDiff: file.fileDiff,
        annotations: buildLineAnnotations(file),
        version: buildCodeViewVersion(file),
      })),
    [files],
  );
  const selectedLines = useMemo(
    () =>
      getSelectedCodeViewLines({
        draftChatAttachments,
        draftCommentTarget,
        files,
      }),
    [draftChatAttachments, draftCommentTarget, files],
  );
  const options = useMemo<CodeViewProps<PatchLineAnnotation>["options"]>(
    () => ({
      ...CODE_VIEW_BASE_OPTIONS,
      onGutterUtilityClick: (range, context) => {
        if (context.type !== "diff") return;

        onOpenLineCommentDraft(context.item.fileDiff.name, range);
      },
    }),
    [onOpenLineCommentDraft],
  );
  const renderHeaderMetadata = useCallback(
    (item: CodeViewItem<PatchLineAnnotation>) => {
      const file = fileByItemId.get(item.id);
      if (!file) return null;

      return (
        <ReviewThreadSummary
          fileReviewThreads={file.fileReviewThreads}
        />
      );
    },
    [fileByItemId],
  );
  const renderAnnotation = useCallback(
    (
      annotation: DiffLineAnnotation<PatchLineAnnotation>,
      item: CodeViewItem<PatchLineAnnotation>,
    ) => {
      if (item.type !== "diff") return null;

      return renderReviewThreadAnnotations(annotation);
    },
    [renderReviewThreadAnnotations],
  );

  return (
    <CodeView
      ref={codeViewRef}
      className="h-full min-h-0 min-w-0 overflow-y-auto scrollbar-hidden"
      items={items}
      options={options}
      renderAnnotation={renderAnnotation}
      renderHeaderMetadata={renderHeaderMetadata}
      selectedLines={selectedLines}
      style={DIFF_FONT_STYLE}
    />
  );
}

const MemoizedPatchCodeView = memo(PatchCodeView);

export {
  getCodeViewItemId,
  MemoizedPatchCodeView as PatchCodeView,
};
export type { PatchLineAnnotation };
