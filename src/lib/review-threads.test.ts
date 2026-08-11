import { describe, expect, it } from "bun:test";
import { buildLocalReviewThreadsByFile } from "./review-threads";

describe("local review threads", () => {
  it("keeps an agent reply in the user's ranged thread", () => {
    const byFile = buildLocalReviewThreadsByFile([
      {
        id: "user-note",
        filePath: "src/app.ts",
        line: 34,
        side: "additions",
        startLine: 28,
        startSide: "additions",
        replyToId: null,
        body: "Why did we add this?",
        author: "user",
        createdAt: 1,
      },
      {
        id: "agent-reply",
        filePath: "src/app.ts",
        line: 34,
        side: "additions",
        startLine: 28,
        startSide: "additions",
        replyToId: "user-note",
        body: "Because the renderer needs the selected theme.",
        author: "agent",
        createdAt: 2,
      },
    ]);

    const file = byFile.get("src/app.ts");
    const thread = file?.lineAnnotations[0]?.metadata.thread;

    expect(file?.totalCount).toBe(1);
    expect(file?.commentCount).toBe(2);
    expect(file?.lineAnnotations).toHaveLength(1);
    expect(thread?.isLocalDraft).toBe(true);
    expect(thread?.startLine).toBe(28);
    expect(thread?.line).toBe(34);
    expect(thread?.comments.map((comment) => comment.id)).toEqual([
      "user-note",
      "agent-reply",
    ]);
    expect(thread?.comments[1]?.replyToId).toBe("user-note");
  });
});
