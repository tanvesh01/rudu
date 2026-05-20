import { describe, expect, it } from "bun:test";
import {
  getAssistantTurnView,
  isMeaningfulFinalText,
  type ReviewChatPart,
} from "./assistant-turn-view";

function text(value: string): ReviewChatPart {
  return { text: value, type: "text" } as ReviewChatPart;
}

function tool(toolCallId: string, title: string): ReviewChatPart {
  return {
    state: "output-available",
    title,
    toolCallId,
    type: `tool-${toolCallId}`,
  } as ReviewChatPart;
}

function plan(): ReviewChatPart {
  return {
    data: {
      entries: [
        {
          content: "Inspect checks",
          priority: "high",
          status: "in_progress",
        },
      ],
    },
    type: "data-acp-plan",
  } as ReviewChatPart;
}

describe("getAssistantTurnView", () => {
  it("keeps pre-tool prose in activity and uses the last post-tool text as the final answer", () => {
    const view = getAssistantTurnView([
      text("I will inspect the PR checks."),
      tool("call-1", "Inspect PR"),
      text("So far I only see GitGuardian."),
      tool("call-2", "List workflow runs"),
      tool("call-3", "Inspect workflow files"),
      text("No GitHub Actions ran for this PR."),
    ]);

    expect(view.finalText).toBe("No GitHub Actions ran for this PR.");
    expect(view.usedTools).toBe(true);
    expect(view.usedFallbackFinalText).toBe(false);
    expect(view.activityItems.map((item) => item.kind)).toEqual([
      "progress",
      "tools",
      "progress",
      "tools",
    ]);
    expect(view.activityItems[0]).toMatchObject({
      kind: "progress",
      text: "I will inspect the PR checks.",
    });
    expect(view.activityItems[3]).toMatchObject({
      kind: "tools",
      parts: [
        { toolCallId: "call-2" },
        { toolCallId: "call-3" },
      ],
    });
  });

  it("uses the full assistant text when a turn has no tool activity", () => {
    const view = getAssistantTurnView([
      text("No findings."),
      { text: "internal thought", type: "reasoning" } as ReviewChatPart,
      text(" The change is narrow."),
    ]);

    expect(view.finalText).toBe("No findings. The change is narrow.");
    expect(view.activityItems).toEqual([]);
    expect(view.usedTools).toBe(false);
  });

  it("falls back to the full assistant text when post-tool text is low signal", () => {
    const view = getAssistantTurnView([
      text("I checked the PR status."),
      tool("call-1", "Inspect PR"),
      text("Done."),
    ]);

    expect(view.finalText).toBe("I checked the PR status.\n\nDone.");
    expect(view.usedFallbackFinalText).toBe(true);
  });

  it("keeps plan updates in activity without making them the final answer", () => {
    const view = getAssistantTurnView([
      plan(),
      text("The PR has no automatic Actions checks."),
    ]);

    expect(view.finalText).toBe("The PR has no automatic Actions checks.");
    expect(view.activityItems.map((item) => item.kind)).toEqual(["plan"]);
  });
});

describe("isMeaningfulFinalText", () => {
  it("accepts concise review conclusions but rejects empty completion markers", () => {
    expect(isMeaningfulFinalText("No findings.")).toBe(true);
    expect(isMeaningfulFinalText("Done.")).toBe(false);
    expect(isMeaningfulFinalText("")).toBe(false);
  });
});
