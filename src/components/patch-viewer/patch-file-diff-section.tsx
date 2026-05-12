import { memo, useCallback, useMemo } from "react";
import type { CSSProperties } from "react";
import type {
  DiffLineAnnotation,
  FileDiffOptions,
  SelectedLineRange,
  VirtualFileMetrics,
} from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import {
  inferCodeLanguageFromPath,
  ReviewCommentComposer,
} from "../ui/review-comment-composer";
import { ReviewThreadCard } from "../ui/review-thread-card";
import {
  normalizePath,
  type FileReviewThreads,
} from "../../lib/review-threads";
import type { ReviewCommentSide } from "../../types/github";
import {
  createComposerBufferState,
  getDraftComposerKey,
  getReplyComposerKey,
  getThreadRefKey,
} from "./review-composer-state";
import {
  type PatchFileRenderPacket,
  type PatchLineAnnotation,
} from "./render-packet";

type FileDiffSectionProps = {
  renderPacket: PatchFileRenderPacket;
};

const VIRTUAL_FILE_METRICS: VirtualFileMetrics = {
  hunkLineCount: 50,
  lineHeight: 20,
  diffHeaderHeight: 44,
  hunkSeparatorHeight: 32,
  fileGap: 8,
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

const FILE_DIFF_BASE_OPTIONS = {
  theme: DIFF_THEME,
  diffStyle: "unified",
  diffIndicators: "bars",
  lineDiffType: "word",
  overflow: "scroll",
  unsafeCSS: DIFF_UNSAFE_CSS,
  enableGutterUtility: true,
  enableLineSelection: true,
} satisfies Omit<FileDiffOptions<PatchLineAnnotation>, "onGutterUtilityClick">;

function cx(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(" ");
}

function toSelectionSide(side: ReviewCommentSide | null | undefined) {
  return side === "LEFT" ? "deletions" : "additions";
}

function ReviewThreadSummary({
  fileReviewThreads,
  hasDraft,
}: {
  fileReviewThreads: FileReviewThreads;
  hasDraft: boolean;
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
      {hasDraft ? (
        <span className="rounded-full bg-canvas px-2 py-0.5 text-ink-700">
          Draft open
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

function buildFileDiffAnnotationSignature(
  fileReviewThreads: FileReviewThreads,
) {
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

function PatchFileDiffSection({
  renderPacket: {
    fileDiff,
    fileReviewThreads,
    lineDraft,
    fileDraft,
    fileLevelActiveComposerKey,
    viewerLogin,
    draftComposerState = createComposerBufferState("draft"),
    onRegisterDiffNode,
    onOpenLineCommentDraft,
    renderReviewThreadAnnotations,
    onCancelDraftComment,
    onCloseActiveComposer,
    onActiveComposerDirtyChange,
    onSubmitDraftComment,
    getReplyComposerState,
    getEditComposerState,
    getSuggestionSeedForThread,
    onEditComment,
    onReplyToThread,
    onRequestEditComposer,
    onRequestReplyComposer,
  },
}: FileDiffSectionProps) {
  const selectedLines = useMemo<SelectedLineRange | null>(
    () =>
      lineDraft
        ? {
            start: lineDraft.startLine ?? lineDraft.line,
            side: toSelectionSide(lineDraft.startSide ?? lineDraft.side),
            end: lineDraft.line,
            endSide: toSelectionSide(lineDraft.side),
          }
        : null,
    [lineDraft],
  );
  const handleGutterUtilityClick = useCallback(
    (range: SelectedLineRange) => onOpenLineCommentDraft(fileDiff.name, range),
    [fileDiff.name, onOpenLineCommentDraft],
  );
  const diffOptions = useMemo<FileDiffOptions<PatchLineAnnotation>>(
    () => ({
      ...FILE_DIFF_BASE_OPTIONS,
      onGutterUtilityClick: handleGutterUtilityClick,
    }),
    [handleGutterUtilityClick],
  );
  const lineAnnotations = useMemo<
    DiffLineAnnotation<PatchLineAnnotation>[]
  >(
    () =>
      lineDraft
        ? [
            ...fileReviewThreads.lineAnnotations,
            {
              side: toSelectionSide(lineDraft.side),
              lineNumber: lineDraft.line,
              metadata: { kind: "draft" },
            },
          ]
        : fileReviewThreads.lineAnnotations,
    [fileReviewThreads.lineAnnotations, lineDraft],
  );
  const renderHeaderMetadata = useCallback(
    () => (
      <ReviewThreadSummary
        fileReviewThreads={fileReviewThreads}
        hasDraft={fileDraft !== null}
      />
    ),
    [fileDraft, fileReviewThreads],
  );
  const fileDiffKey = useMemo(
    () =>
      [
        normalizePath(fileDiff.name),
        buildFileDiffAnnotationSignature(fileReviewThreads),
        lineDraft ? getDraftComposerKey(lineDraft) : "no-draft",
      ].join("::"),
    [fileDiff.name, fileReviewThreads, lineDraft],
  );

  return (
    <div
      data-file-path={fileDiff.name}
      ref={(node) => onRegisterDiffNode(fileDiff.name, node)}
    >
      <FileDiff
        key={fileDiffKey}
        fileDiff={fileDiff}
        metrics={VIRTUAL_FILE_METRICS}
        lineAnnotations={lineAnnotations}
        selectedLines={selectedLines}
        style={DIFF_FONT_STYLE}
        options={diffOptions}
        renderAnnotation={renderReviewThreadAnnotations}
        renderHeaderMetadata={renderHeaderMetadata}
      />
      {fileReviewThreads.fileThreads.length > 0 || fileDraft ? (
        <div className="mt-3 flex flex-col gap-3 rounded-xl border border-ink-200 bg-surface p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-ink-500">
            File threads
          </div>
          {fileDraft ? (
            <ReviewCommentComposer
              allowSuggestion={false}
              error={draftComposerState.error}
              initialValue={draftComposerState.initialValue}
              isPending={draftComposerState.isPending}
              suggestionLanguage={inferCodeLanguageFromPath(fileDiff.name)}
              submitLabel="Comment"
              onCancel={onCancelDraftComment}
              onDirtyChange={onActiveComposerDirtyChange}
              onSubmit={onSubmitDraftComment}
            />
          ) : null}
          {fileReviewThreads.fileThreads.map((thread) => {
            const suggestionSeed = getSuggestionSeedForThread(thread);

            return (
              <ReviewThreadCard
                activeEditCommentId={
                  fileLevelActiveComposerKey?.startsWith("edit:")
                    ? fileLevelActiveComposerKey.slice("edit:".length)
                    : null
                }
                isReplyComposerActive={
                  fileLevelActiveComposerKey === getReplyComposerKey(thread)
                }
                getEditComposerState={getEditComposerState}
                replyComposerState={getReplyComposerState(thread)}
                suggestionLanguage={inferCodeLanguageFromPath(thread.path)}
                suggestionSeed={suggestionSeed}
                onComposerDirtyChange={onActiveComposerDirtyChange}
                key={getThreadRefKey(thread)}
                onEditComment={onEditComment}
                onReplyToThread={onReplyToThread}
                onRequestCloseComposer={onCloseActiveComposer}
                onRequestEditComposer={onRequestEditComposer}
                onRequestReplyComposer={onRequestReplyComposer}
                thread={thread}
                viewerLogin={viewerLogin}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

const FileDiffSection = memo(PatchFileDiffSection);

export { FileDiffSection, buildFileDiffAnnotationSignature };
