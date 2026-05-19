import { describe, expect, it } from "bun:test";
import {
  appendOptimisticReply,
  createOptimisticComment,
  createOptimisticThread,
  createTemporaryId,
  insertOptimisticThread,
  updateOptimisticComment,
} from "./review-thread-optimistic";
import type { ReviewThread } from "./review-threads";

const mockAuthor = {
  login: "octocat",
  avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
};

function makeThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: "thread-1",
    path: "src/app.ts",
    isResolved: false,
    isOutdated: false,
    line: 2,
    startLine: null,
    side: "RIGHT",
    startSide: null,
    subjectType: "line",
    comments: [
      {
        id: "comment-1",
        databaseId: 1,
        authorLogin: "octocat",
        authorAvatarUrl: null,
        authorAssociation: "MEMBER",
        body: "Please adjust this.",
        createdAt: "2026-05-11T00:00:00Z",
        updatedAt: "2026-05-11T00:00:00Z",
        url: "https://github.com/outerworld/rudu/pull/1#discussion_r1",
        replyToId: null,
      },
    ],
    ...overrides,
  };
}

describe("review-thread-optimistic", () => {
  describe("createTemporaryId", () => {
    it("prefixes the id with the given prefix", () => {
      const id = createTemporaryId("temp");
      expect(id.startsWith("temp:")).toBe(true);
    });

    it("includes a timestamp and random suffix", () => {
      const id = createTemporaryId("test");
      const parts = id.split(":");
      expect(parts.length).toBe(3);
      expect(Number.isNaN(Number(parts[1]))).toBe(false);
      expect(parts[2].length).toBeGreaterThan(0);
    });
  });

  describe("createOptimisticComment", () => {
    it("creates a comment with the given body and author", () => {
      const comment = createOptimisticComment(
        "LGTM",
        mockAuthor.login,
        mockAuthor.avatarUrl,
        null,
      );

      expect(comment.body).toBe("LGTM");
      expect(comment.authorLogin).toBe("octocat");
      expect(comment.authorAvatarUrl).toBe(mockAuthor.avatarUrl);
      expect(comment.replyToId).toBeNull();
    });

    it("marks the comment as pending and optimistic", () => {
      const comment = createOptimisticComment(
        "LGTM",
        mockAuthor.login,
        mockAuthor.avatarUrl,
        null,
      );

      expect(comment.isPending).toBe(true);
      expect(comment.isOptimistic).toBe(true);
    });

    it("sets a temporary id, null databaseId, and empty url", () => {
      const comment = createOptimisticComment(
        "LGTM",
        mockAuthor.login,
        mockAuthor.avatarUrl,
        null,
      );

      expect(comment.id.startsWith("temp-comment:")).toBe(true);
      expect(comment.databaseId).toBeNull();
      expect(comment.url).toBe("");
    });

    it("includes a replyToId when provided", () => {
      const comment = createOptimisticComment(
        "Thanks!",
        mockAuthor.login,
        mockAuthor.avatarUrl,
        "comment-1",
      );

      expect(comment.replyToId).toBe("comment-1");
    });
  });

  describe("createOptimisticThread", () => {
    it("creates a thread with the given input and root comment", () => {
      const rootComment = createOptimisticComment(
        "LGTM",
        mockAuthor.login,
        mockAuthor.avatarUrl,
        null,
      );
      const thread = createOptimisticThread(
        {
          path: "src/app.ts",
          line: 2,
          startLine: null,
          side: "RIGHT",
          startSide: null,
          subjectType: "line",
        },
        rootComment,
      );

      expect(thread.path).toBe("src/app.ts");
      expect(thread.line).toBe(2);
      expect(thread.side).toBe("RIGHT");
      expect(thread.comments).toEqual([rootComment]);
    });

    it("marks the thread as pending and optimistic", () => {
      const rootComment = createOptimisticComment(
        "LGTM",
        mockAuthor.login,
        mockAuthor.avatarUrl,
        null,
      );
      const thread = createOptimisticThread(
        {
          path: "src/app.ts",
          line: null,
          startLine: null,
          side: null,
          startSide: null,
          subjectType: "file",
        },
        rootComment,
      );

      expect(thread.isPending).toBe(true);
      expect(thread.isOptimistic).toBe(true);
      expect(thread.isResolved).toBe(false);
      expect(thread.isOutdated).toBe(false);
    });
  });

  describe("insertOptimisticThread", () => {
    it("appends the thread to the list", () => {
      const threadA = makeThread({ id: "thread-a" });
      const threadB = makeThread({ id: "thread-b" });
      const next = insertOptimisticThread([threadA], threadB);

      expect(next).toHaveLength(2);
      expect(next[1].id).toBe("thread-b");
    });

    it("does not mutate the original array", () => {
      const threadA = makeThread({ id: "thread-a" });
      const original = [threadA];
      const next = insertOptimisticThread(original, makeThread({ id: "thread-b" }));

      expect(original).toHaveLength(1);
      expect(next).toHaveLength(2);
    });
  });

  describe("appendOptimisticReply", () => {
    it("adds a comment to the matching thread", () => {
      const thread = makeThread({ id: "thread-1" });
      const reply = createOptimisticComment(
        "Reply",
        mockAuthor.login,
        mockAuthor.avatarUrl,
        "comment-1",
      );
      const next = appendOptimisticReply([thread], "thread-1", reply);

      expect(next[0].comments).toHaveLength(2);
      expect(next[0].comments[1].body).toBe("Reply");
    });

    it("leaves other threads untouched", () => {
      const threadA = makeThread({ id: "thread-a" });
      const threadB = makeThread({ id: "thread-b" });
      const reply = createOptimisticComment(
        "Reply",
        mockAuthor.login,
        mockAuthor.avatarUrl,
        null,
      );
      const next = appendOptimisticReply([threadA, threadB], "thread-b", reply);

      expect(next[0].comments).toHaveLength(1);
      expect(next[1].comments).toHaveLength(2);
    });

    it("does not mutate the original threads", () => {
      const thread = makeThread({ id: "thread-1" });
      const original = [thread];
      const reply = createOptimisticComment(
        "Reply",
        mockAuthor.login,
        mockAuthor.avatarUrl,
        null,
      );
      const next = appendOptimisticReply(original, "thread-1", reply);

      expect(original[0].comments).toHaveLength(1);
      expect(next[0].comments).toHaveLength(2);
    });
  });

  describe("updateOptimisticComment", () => {
    it("updates the body and marks the comment as pending/optimistic", () => {
      const thread = makeThread({ id: "thread-1" });
      const next = updateOptimisticComment([thread], "comment-1", "Updated body");

      const updatedComment = next[0].comments[0];
      expect(updatedComment.body).toBe("Updated body");
      expect(updatedComment.isPending).toBe(true);
      expect(updatedComment.isOptimistic).toBe(true);
    });

    it("leaves other comments untouched", () => {
      const thread = makeThread({
        id: "thread-1",
        comments: [
          makeThread().comments[0],
          {
            id: "comment-2",
            databaseId: 2,
            authorLogin: "octocat",
            authorAvatarUrl: null,
            authorAssociation: "MEMBER",
            body: "Another comment",
            createdAt: "2026-05-11T00:00:00Z",
            updatedAt: "2026-05-11T00:00:00Z",
            url: "https://github.com/outerworld/rudu/pull/1#discussion_r2",
            replyToId: null,
          },
        ],
      });
      const next = updateOptimisticComment([thread], "comment-1", "Updated");

      expect(next[0].comments[0].body).toBe("Updated");
      expect(next[0].comments[1].body).toBe("Another comment");
    });

    it("does not mutate the original threads", () => {
      const thread = makeThread({ id: "thread-1" });
      const original = [thread];
      const next = updateOptimisticComment(original, "comment-1", "Updated");

      expect(original[0].comments[0].body).toBe("Please adjust this.");
      expect(next[0].comments[0].body).toBe("Updated");
    });
  });
});
