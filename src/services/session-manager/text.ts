const UTF8 = "utf8";

function tailWithinUtf8Budget(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";

  const codePoints = Array.from(text);
  let usedBytes = 0;
  let startIndex = codePoints.length;

  while (startIndex > 0) {
    const next = codePoints[startIndex - 1]!;
    const nextBytes = Buffer.byteLength(next, UTF8);
    if (usedBytes + nextBytes > maxBytes) break;
    usedBytes += nextBytes;
    startIndex -= 1;
  }

  return codePoints.slice(startIndex).join("");
}

export function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, UTF8);
}

export function truncateUtf8FromEnd(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (utf8ByteLength(text) <= maxBytes) return text;
  if (maxBytes <= 3) return tailWithinUtf8Budget(text, maxBytes);
  return `...${tailWithinUtf8Budget(text, maxBytes - 3)}`;
}
