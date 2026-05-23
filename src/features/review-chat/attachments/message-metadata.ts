import {
  createDiffLinesAttachment,
  getReviewChatAttachmentKey,
  type ReviewChatAttachment,
  type ReviewChatInlineAttachment,
} from "./model";
import type { ReviewLineSelection } from "../selection/line-selection";

type ReviewChatInlineAttachmentRange = {
  attachment: ReviewChatInlineAttachment;
  end: number;
  start: number;
  text: string;
};

type ReviewChatInlineMessageSegment =
  | {
      kind: "text";
      text: string;
    }
  | {
      attachment: ReviewChatInlineAttachment;
      end: number;
      kind: "attachment";
      start: number;
      text: string;
    };

type ReviewChatCommandMetadata = {
  kind: "review-walkthrough";
  label: string;
};

type ReviewChatMessageMetadata = {
  acpStopReason?: string | null;
  attachments?: ReviewChatAttachment[];
  command?: ReviewChatCommandMetadata;
  inlineAttachments?: ReviewChatInlineAttachmentRange[];
  reviewEffortMode?: "fast" | "deep";
  selectedLineContext?: ReviewLineSelection | null;
  finishedAt?: number;
  startedAt?: number;
  turnId?: string;
};

function normalizeAttachmentsFromMetadata(
  metadata: ReviewChatMessageMetadata | undefined,
) {
  if (!metadata) {
    return [];
  }

  if (metadata.attachments) {
    return metadata.attachments;
  }

  if (metadata.selectedLineContext) {
    return [createDiffLinesAttachment(metadata.selectedLineContext)];
  }

  return [];
}

function normalizeInlineAttachmentsFromMetadata(
  metadata: ReviewChatMessageMetadata | undefined,
) {
  return metadata?.inlineAttachments ?? [];
}

function getMessageAttachmentStripItems(
  metadata: ReviewChatMessageMetadata | undefined,
) {
  const attachments = normalizeAttachmentsFromMetadata(metadata);
  const inlineAttachments = normalizeInlineAttachmentsFromMetadata(metadata);

  if (inlineAttachments.length === 0) {
    return attachments;
  }

  const inlineAttachmentKeys = new Set(
    inlineAttachments.map((range) =>
      getReviewChatAttachmentKey(range.attachment),
    ),
  );

  return attachments.filter(
    (attachment) =>
      !inlineAttachmentKeys.has(getReviewChatAttachmentKey(attachment)),
  );
}

function trimInlineAttachmentRanges(
  text: string,
  inlineAttachments: ReviewChatInlineAttachmentRange[],
) {
  const trimmedStartOffset = text.length - text.trimStart().length;
  const trimmedText = text.trim();

  return inlineAttachments
    .map((range) => ({
      ...range,
      end: range.end - trimmedStartOffset,
      start: range.start - trimmedStartOffset,
    }))
    .filter(
      (range) =>
        range.start >= 0 &&
        range.end > range.start &&
        range.end <= trimmedText.length,
    );
}

function splitTextByInlineAttachments(
  text: string,
  inlineAttachments: ReviewChatInlineAttachmentRange[],
): ReviewChatInlineMessageSegment[] {
  const segments: ReviewChatInlineMessageSegment[] = [];
  const sortedRanges = [...inlineAttachments].sort(
    (first, second) => first.start - second.start || first.end - second.end,
  );
  let cursor = 0;

  for (const range of sortedRanges) {
    if (
      range.start < cursor ||
      range.start < 0 ||
      range.end <= range.start ||
      range.end > text.length
    ) {
      continue;
    }

    if (range.start > cursor) {
      segments.push({
        kind: "text",
        text: text.slice(cursor, range.start),
      });
    }

    segments.push({
      attachment: range.attachment,
      end: range.end,
      kind: "attachment",
      start: range.start,
      text: text.slice(range.start, range.end),
    });
    cursor = range.end;
  }

  if (cursor < text.length) {
    segments.push({
      kind: "text",
      text: text.slice(cursor),
    });
  }

  return segments.length > 0 ? segments : [{ kind: "text", text }];
}

export {
  getMessageAttachmentStripItems,
  normalizeAttachmentsFromMetadata,
  normalizeInlineAttachmentsFromMetadata,
  splitTextByInlineAttachments,
  trimInlineAttachmentRanges,
};
export type {
  ReviewChatCommandMetadata,
  ReviewChatInlineAttachmentRange,
  ReviewChatInlineMessageSegment,
  ReviewChatMessageMetadata,
};
