import type { ReactNode } from "react";
import type {
  DiffLineAnnotation,
  FileDiffMetadata,
  SelectedLineRange,
} from "@pierre/diffs";
import type {
  FileReviewThreads,
  ReviewComment,
  ReviewThread,
  ReviewThreadAnnotation,
} from "../../lib/review-threads";
import type {
  ComposerBufferState,
  DraftReviewCommentTarget,
} from "./review-composer-state";
import type { PatchViewFile } from "./patch-view-model";

type DraftReviewCommentAnnotation = {
  kind: "draft";
};

type PatchLineAnnotation =
  | ReviewThreadAnnotation
  | DraftReviewCommentAnnotation;

type PatchFileRenderPacket = {
  fileDiff: FileDiffMetadata;
  normalizedPath: string;
  fileReviewThreads: FileReviewThreads;
  lineDraft: Extract<DraftReviewCommentTarget, { type: "line" }> | null;
  fileDraft: Extract<DraftReviewCommentTarget, { type: "file" }> | null;
  fileLevelActiveComposerKey: string | null;
  draftComposerState: ComposerBufferState;
  getEditComposerState: (comment: ReviewComment) => ComposerBufferState;
  getReplyComposerState: (thread: ReviewThread) => ComposerBufferState;
  onActiveComposerDirtyChange: (isDirty: boolean) => void;
  onCancelDraftComment: () => void;
  onCloseActiveComposer: () => void;
  onEditComment: (comment: ReviewComment, body: string) => Promise<void>;
  onOpenLineCommentDraft: (path: string, range: SelectedLineRange) => void;
  onRegisterDiffNode: (path: string, node: HTMLDivElement | null) => void;
  onReplyToThread: (thread: ReviewThread, body: string) => Promise<void>;
  onRequestEditComposer: (comment: ReviewComment) => void;
  onRequestReplyComposer: (thread: ReviewThread) => void;
  onSubmitDraftComment: (body: string) => Promise<void> | void;
  renderReviewThreadAnnotations: (
    annotation: DiffLineAnnotation<PatchLineAnnotation>,
  ) => ReactNode;
  viewerLogin: string | null;
  getSuggestionSeedForThread: (thread: ReviewThread) => string | undefined;
};

type PatchFileRenderCallers = Pick<
  PatchFileRenderPacket,
  | "draftComposerState"
  | "getEditComposerState"
  | "getReplyComposerState"
  | "onActiveComposerDirtyChange"
  | "onCancelDraftComment"
  | "onCloseActiveComposer"
  | "onEditComment"
  | "onOpenLineCommentDraft"
  | "onRegisterDiffNode"
  | "onReplyToThread"
  | "onRequestEditComposer"
  | "onRequestReplyComposer"
  | "onSubmitDraftComment"
  | "renderReviewThreadAnnotations"
  | "viewerLogin"
  | "getSuggestionSeedForThread"
>;

function createPatchFileRenderPacket(
  viewFile: PatchViewFile,
  callers: PatchFileRenderCallers,
): PatchFileRenderPacket {
  return {
    fileDiff: viewFile.fileDiff,
    normalizedPath: viewFile.normalizedPath,
    fileReviewThreads: viewFile.fileReviewThreads,
    lineDraft: viewFile.lineDraft,
    fileDraft: viewFile.fileDraft,
    fileLevelActiveComposerKey: viewFile.fileLevelActiveComposerKey,
    draftComposerState: callers.draftComposerState,
    getEditComposerState: callers.getEditComposerState,
    getReplyComposerState: callers.getReplyComposerState,
    onActiveComposerDirtyChange: callers.onActiveComposerDirtyChange,
    onCancelDraftComment: callers.onCancelDraftComment,
    onCloseActiveComposer: callers.onCloseActiveComposer,
    onEditComment: callers.onEditComment,
    onOpenLineCommentDraft: callers.onOpenLineCommentDraft,
    onRegisterDiffNode: callers.onRegisterDiffNode,
    onReplyToThread: callers.onReplyToThread,
    onRequestEditComposer: callers.onRequestEditComposer,
    onRequestReplyComposer: callers.onRequestReplyComposer,
    onSubmitDraftComment: callers.onSubmitDraftComment,
    renderReviewThreadAnnotations: callers.renderReviewThreadAnnotations,
    viewerLogin: callers.viewerLogin,
    getSuggestionSeedForThread: callers.getSuggestionSeedForThread,
  };
}

export { createPatchFileRenderPacket };
export type {
  DraftReviewCommentAnnotation,
  PatchFileRenderCallers,
  PatchFileRenderPacket,
  PatchLineAnnotation,
};
