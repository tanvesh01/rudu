import type { DiffLineAnnotation } from "@pierre/diffs";

type ReviewComment = {
  id: string;
  databaseId: number | null;
  authorLogin: string;
  authorAvatarUrl: string | null;
  authorAssociation: string | null;
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

const EMPTY_FILE_REVIEW_THREADS: FileReviewThreads = {
  fileThreads: [],
  lineAnnotations: [],
  totalCount: 0,
  unresolvedCount: 0,
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

function createFileReviewThreads(fileThreads: ReviewThread[]): FileReviewThreads {
  const sortedThreads = [...fileThreads].sort(compareThreads);
  const lineAnnotations = sortedThreads.flatMap((thread) => {
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

  const fileLevelThreads = sortedThreads.filter(
    (thread) =>
      thread.subjectType === "file" ||
      thread.line === null ||
      getAnnotationSide(thread.side) === null,
  );
  const unresolvedCount = sortedThreads.reduce(
    (count, thread) => (thread.isResolved ? count : count + 1),
    0,
  );

  return {
    fileThreads: fileLevelThreads,
    lineAnnotations,
    totalCount: sortedThreads.length,
    unresolvedCount,
  };
}

function buildReviewThreadsByFile(
  reviewThreads: ReviewThread[],
): Map<string, FileReviewThreads> {
  const groupedThreads = new Map<string, ReviewThread[]>();

  for (const thread of reviewThreads) {
    const normalizedPath = normalizePath(thread.path);
    const existingGroup = groupedThreads.get(normalizedPath);

    if (existingGroup) {
      existingGroup.push(thread);
      continue;
    }

    groupedThreads.set(normalizedPath, [thread]);
  }

  const reviewThreadsByFile = new Map<string, FileReviewThreads>();

  for (const [filePath, fileThreads] of groupedThreads) {
    reviewThreadsByFile.set(filePath, createFileReviewThreads(fileThreads));
  }

  return reviewThreadsByFile;
}

function getFileReviewThreadsForPath(
  reviewThreadsByFile: Map<string, FileReviewThreads>,
  filePath: string,
): FileReviewThreads {
  return reviewThreadsByFile.get(normalizePath(filePath)) ?? EMPTY_FILE_REVIEW_THREADS;
}

export {
  buildReviewThreadsByFile,
  EMPTY_FILE_REVIEW_THREADS,
  getFileReviewThreadsForPath,
  normalizePath,
};
export type { FileReviewThreads, ReviewComment, ReviewThread, ReviewThreadAnnotation };
