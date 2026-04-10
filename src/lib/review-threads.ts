import type { DiffLineAnnotation } from "@pierre/diffs";

type ReviewComment = {
  id: string;
  databaseId: number | null;
  authorLogin: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  replyToId: string | null;
};

type ReviewThread = {
  id: string;
  path: string;
  isResolved: boolean;
  isOutdated: boolean;
  line: number | null;
  startLine: number | null;
  side: "LEFT" | "RIGHT" | null;
  startSide: "LEFT" | "RIGHT" | null;
  subjectType: "line" | "file" | null;
  comments: ReviewComment[];
};

type ReviewThreadAnnotation = {
  thread: ReviewThread;
};

type FileReviewThreads = {
  fileThreads: ReviewThread[];
  lineAnnotations: DiffLineAnnotation<ReviewThreadAnnotation>[];
  totalCount: number;
  unresolvedCount: number;
};

function normalizePath(path: string) {
  return path.replace(/^[ab]\//, "");
}

function getAnnotationSide(
  side: ReviewThread["side"],
): DiffLineAnnotation<ReviewThreadAnnotation>["side"] | null {
  if (side === "RIGHT") return "additions";
  if (side === "LEFT") return "deletions";
  return null;
}

function getThreadSortLine(thread: ReviewThread) {
  return thread.startLine ?? thread.line ?? Number.MAX_SAFE_INTEGER;
}

function compareThreads(a: ReviewThread, b: ReviewThread) {
  return getThreadSortLine(a) - getThreadSortLine(b);
}

function getFileReviewThreads(
  reviewThreads: ReviewThread[],
  filePath: string,
): FileReviewThreads {
  const normalizedFilePath = normalizePath(filePath);
  const fileThreads = reviewThreads
    .filter((thread) => normalizePath(thread.path) === normalizedFilePath)
    .sort(compareThreads);

  const lineAnnotations = fileThreads.flatMap((thread) => {
    const annotationSide = getAnnotationSide(thread.side);
    if (thread.subjectType === "file" || thread.line === null || !annotationSide) {
      return [];
    }

    return [
      {
        side: annotationSide,
        lineNumber: thread.line,
        metadata: { thread },
      },
    ];
  });

  return {
    fileThreads: fileThreads.filter(
      (thread) =>
        thread.subjectType === "file" ||
        thread.line === null ||
        getAnnotationSide(thread.side) === null,
    ),
    lineAnnotations,
    totalCount: fileThreads.length,
    unresolvedCount: fileThreads.filter((thread) => !thread.isResolved).length,
  };
}

export { getFileReviewThreads };
export type { FileReviewThreads, ReviewComment, ReviewThread, ReviewThreadAnnotation };
