import type { ReviewChatMessage } from "../runtime/transport";

type ReviewChatPart = ReviewChatMessage["parts"][number];
type ReviewChatTextPart = ReviewChatPart & { type: "text"; text: string };
type ReviewChatPlanPart = ReviewChatPart & { type: "data-acp-plan" };
type ReviewChatToolPart = ReviewChatPart & { toolCallId: string };

type TextGroup = {
  endIndex: number;
  parts: ReviewChatTextPart[];
  startIndex: number;
  text: string;
};

type AssistantTurnActivityItem =
  | { kind: "progress"; parts: ReviewChatTextPart[]; text: string }
  | { kind: "tools"; parts: ReviewChatToolPart[] }
  | { kind: "plan"; part: ReviewChatPlanPart };

type AssistantTurnView = {
  activityItems: AssistantTurnActivityItem[];
  finalText: string;
  finalTextParts: ReviewChatTextPart[];
  hasActivity: boolean;
  usedFallbackFinalText: boolean;
  usedTools: boolean;
};

function isToolPart(part: ReviewChatPart): part is ReviewChatToolPart {
  return "toolCallId" in part;
}

function isTextPart(part: ReviewChatPart): part is ReviewChatTextPart {
  return part.type === "text";
}

function isPlanPart(part: ReviewChatPart): part is ReviewChatPlanPart {
  return part.type === "data-acp-plan";
}

function normalizeFinalText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function isMeaningfulFinalText(text: string) {
  const normalized = normalizeFinalText(text);
  if (!normalized) return false;

  const lowSignal = normalized.toLowerCase().replace(/[.!?\s]+$/g, "");
  return !["done", "ok", "okay", "complete", "completed"].includes(
    lowSignal,
  );
}

function joinTextParts(parts: ReviewChatTextPart[]) {
  return parts.map((part) => part.text).join("");
}

function getTextGroups(parts: ReviewChatPart[]) {
  const groups: TextGroup[] = [];
  let activeGroup: TextGroup | null = null;

  parts.forEach((part, index) => {
    if (!isTextPart(part)) {
      activeGroup = null;
      return;
    }

    if (!activeGroup) {
      activeGroup = {
        endIndex: index,
        parts: [],
        startIndex: index,
        text: "",
      };
      groups.push(activeGroup);
    }

    activeGroup.parts.push(part);
    activeGroup.endIndex = index;
    activeGroup.text = joinTextParts(activeGroup.parts);
  });

  return groups;
}

function getFallbackFinalTextGroup(
  textGroups: TextGroup[],
  separator = "",
): TextGroup | null {
  const allTextParts = textGroups.flatMap((group) => group.parts);
  if (allTextParts.length === 0) return null;

  return {
    endIndex: textGroups[textGroups.length - 1]?.endIndex ?? 0,
    parts: allTextParts,
    startIndex: textGroups[0]?.startIndex ?? 0,
    text: textGroups.map((group) => group.text).join(separator),
  };
}

function getFinalTextGroup(parts: ReviewChatPart[]) {
  const textGroups = getTextGroups(parts);
  let lastToolIndex = -1;

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (isToolPart(parts[index])) {
      lastToolIndex = index;
      break;
    }
  }

  if (lastToolIndex === -1) {
    return {
      group: getFallbackFinalTextGroup(textGroups),
      usedFallback: false,
      usedTools: false,
    };
  }

  const postToolGroup =
    [...textGroups].reverse().find((group) => group.startIndex > lastToolIndex) ??
    null;

  if (postToolGroup && isMeaningfulFinalText(postToolGroup.text)) {
    return {
      group: postToolGroup,
      usedFallback: false,
      usedTools: true,
    };
  }

  return {
    group: getFallbackFinalTextGroup(textGroups, "\n\n"),
    usedFallback: true,
    usedTools: true,
  };
}

function sameTextGroup(left: TextGroup, right: TextGroup | null) {
  return (
    Boolean(right) &&
    left.startIndex === right?.startIndex &&
    left.endIndex === right.endIndex
  );
}

function getAssistantTurnView(parts: ReviewChatPart[]): AssistantTurnView {
  const final = getFinalTextGroup(parts);
  const textGroups = getTextGroups(parts);
  const activityItems: AssistantTurnActivityItem[] = [];

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const textGroup = textGroups.find((group) => group.startIndex === index);

    if (textGroup) {
      if (
        final.usedTools &&
        !final.usedFallback &&
        !sameTextGroup(textGroup, final.group)
      ) {
        activityItems.push({
          kind: "progress",
          parts: textGroup.parts,
          text: textGroup.text,
        });
      }
      index = textGroup.endIndex;
      continue;
    }

    if (isToolPart(part)) {
      const toolParts: ReviewChatToolPart[] = [part];
      while (index + 1 < parts.length && isToolPart(parts[index + 1])) {
        index += 1;
        const nextPart = parts[index];
        if (isToolPart(nextPart)) {
          toolParts.push(nextPart);
        }
      }
      activityItems.push({ kind: "tools", parts: toolParts });
      continue;
    }

    if (isPlanPart(part)) {
      activityItems.push({ kind: "plan", part });
    }
  }

  const finalText = final.group?.text ?? "";

  return {
    activityItems,
    finalText,
    finalTextParts: final.group?.parts ?? [],
    hasActivity: activityItems.length > 0,
    usedFallbackFinalText: final.usedFallback,
    usedTools: final.usedTools,
  };
}

export {
  getAssistantTurnView,
  isMeaningfulFinalText,
  isPlanPart,
  isTextPart,
  isToolPart,
};
export type {
  AssistantTurnActivityItem,
  AssistantTurnView,
  ReviewChatPart,
  ReviewChatPlanPart,
  ReviewChatTextPart,
  ReviewChatToolPart,
};
