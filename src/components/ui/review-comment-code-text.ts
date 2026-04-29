function normalizeSeededCodeText(text: string) {
  const normalizedText = text.replace(/\r\n/g, "\n");
  const lines = normalizedText.split("\n");
  const interleavedBlankIndexes = new Set<number>();
  let nonBlankCount = 0;

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim().length > 0) {
      nonBlankCount += 1;
      continue;
    }

    const previousLine = lines[index - 1];
    const nextLine = lines[index + 1];
    if (
      previousLine !== undefined &&
      nextLine !== undefined &&
      previousLine.trim().length > 0 &&
      nextLine.trim().length > 0
    ) {
      interleavedBlankIndexes.add(index);
    }
  }

  if (
    interleavedBlankIndexes.size < 2 ||
    interleavedBlankIndexes.size < Math.floor(nonBlankCount / 2)
  ) {
    return normalizedText;
  }

  return lines
    .filter((_, index) => !interleavedBlankIndexes.has(index))
    .join("\n");
}

export { normalizeSeededCodeText };
