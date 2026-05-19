import type { ReviewComment, ReviewThread } from "./review-threads";

export function createTemporaryId(prefix: string): string {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

export function createOptimisticComment(
  body: string,
  authorLogin: string,
  authorAvatarUrl: string | null,
  replyToId: string | null,
): ReviewComment {
  const timestamp = new Date().toISOString();

  return {
    id: createTemporaryId("temp-comment"),
    databaseId: null,
    authorLogin,
    authorAvatarUrl,
    authorAssociation: null,
    body,
    createdAt: timestamp,
    updatedAt: timestamp,
    url: "",
    replyToId,
    isPending: true,
    isOptimistic: true,
  };
}

export function createOptimisticThread(
  input: {
    path: string;
    line: number | null;
    startLine: number | null;
    side: "LEFT" | "RIGHT" | null;
    startSide: "LEFT" | "RIGHT" | null;
    subjectType: "file" | "line";
  },
  rootComment: ReviewComment,
): ReviewThread {
  return {
    id: createTemporaryId("temp-thread"),
    path: input.path,
    isResolved: false,
    isOutdated: false,
    line: input.line,
    startLine: input.startLine,
    side: input.side,
    startSide: input.startSide,
    subjectType: input.subjectType,
    comments: [rootComment],
    isPending: true,
    isOptimistic: true,
  };
}

export function insertOptimisticThread(
  threads: ReviewThread[],
  thread: ReviewThread,
): ReviewThread[] {
  return [...threads, thread];
}

export function appendOptimisticReply(
  threads: ReviewThread[],
  threadId: string,
  comment: ReviewComment,
): ReviewThread[] {
  return threads.map((thread) => {
    if (thread.id !== threadId) {
      return thread;
    }

    return {
      ...thread,
      comments: [...thread.comments, comment],
    };
  });
}

export function updateOptimisticComment(
  threads: ReviewThread[],
  commentId: string,
  body: string,
): ReviewThread[] {
  const updatedAt = new Date().toISOString();

  return threads.map((thread) => ({
    ...thread,
    comments: thread.comments.map((comment) => {
      if (comment.id !== commentId) {
        return comment;
      }

      return {
        ...comment,
        body,
        updatedAt,
        isPending: true,
        isOptimistic: true,
      };
    }),
  }));
}
