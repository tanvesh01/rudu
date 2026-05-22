import { describe, expect, it } from "bun:test";
import type {
  FileStatsEntry,
  ReviewWalkthroughFile,
} from "../../../types/github";
import {
  getWalkthroughFileLineStats,
  getWalkthroughGroupLineStats,
} from "./view";

const fileStatsByPath = new Map<string, FileStatsEntry>([
  [
    "src/app.ts",
    {
      additions: 10,
      deletions: 2,
      status: "modified",
    },
  ],
  [
    "src/empty.ts",
    {
      additions: 0,
      deletions: 0,
      status: "modified",
    },
  ],
]);

function makeFile(path: string): ReviewWalkthroughFile {
  return {
    action: "review",
    context: "Check the implementation.",
    path,
    reason: "It changed.",
    scope: "shared",
  };
}

describe("review walkthrough line stats", () => {
  it("finds file stats using normalized diff paths", () => {
    expect(
      getWalkthroughFileLineStats(fileStatsByPath, "b/src/app.ts"),
    ).toEqual({
      additions: 10,
      deletions: 2,
    });
  });

  it("totals files when every walkthrough file has available stats", () => {
    expect(
      getWalkthroughGroupLineStats(fileStatsByPath, [
        makeFile("src/app.ts"),
        makeFile("src/empty.ts"),
      ]),
    ).toEqual({
      additions: 10,
      deletions: 2,
    });
  });

  it("returns null when any walkthrough file is missing stats", () => {
    expect(
      getWalkthroughGroupLineStats(fileStatsByPath, [
        makeFile("src/app.ts"),
        makeFile("src/missing.ts"),
      ]),
    ).toBeNull();
  });
});
