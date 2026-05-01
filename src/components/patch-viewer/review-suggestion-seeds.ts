import type {
  ChangeContent,
  ContextContent,
  FileDiffMetadata,
} from "@pierre/diffs";

function isContextContent(
  content: ContextContent | ChangeContent,
): content is ContextContent {
  return content.type === "context";
}

function getAdditionLineTextMap(fileDiff: FileDiffMetadata) {
  const lineMap = new Map<number, string>();

  for (const hunk of fileDiff.hunks) {
    let nextAdditionLine = hunk.additionStart;

    for (const content of hunk.hunkContent) {
      if (isContextContent(content)) {
        for (let index = 0; index < content.lines; index += 1) {
          lineMap.set(
            nextAdditionLine + index,
            fileDiff.additionLines[content.additionLineIndex + index] ?? "",
          );
        }
        nextAdditionLine += content.lines;
        continue;
      }

      for (let index = 0; index < content.additions; index += 1) {
        lineMap.set(
          nextAdditionLine + index,
          fileDiff.additionLines[content.additionLineIndex + index] ?? "",
        );
      }
      nextAdditionLine += content.additions;
    }
  }

  return lineMap;
}

function getSuggestionSeedForLineRange(
  fileDiff: FileDiffMetadata | undefined,
  startLine: number | null,
  endLine: number | null,
) {
  if (!fileDiff || startLine === null || endLine === null) {
    return undefined;
  }

  const lineMap = getAdditionLineTextMap(fileDiff);
  const minLine = Math.min(startLine, endLine);
  const maxLine = Math.max(startLine, endLine);
  const selectedLines: string[] = [];

  for (let lineNumber = minLine; lineNumber <= maxLine; lineNumber += 1) {
    const line = lineMap.get(lineNumber);
    if (line === undefined) {
      return undefined;
    }
    selectedLines.push(line);
  }

  return selectedLines.join("\n");
}

export { getSuggestionSeedForLineRange };
