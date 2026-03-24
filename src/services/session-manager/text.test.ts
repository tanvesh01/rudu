import { expect, test } from "bun:test";
import { truncateUtf8FromEnd, utf8ByteLength } from "./text.js";

test("utf8ByteLength counts multibyte characters", () => {
  expect(utf8ByteLength("abc")).toBe(3);
  expect(utf8ByteLength("🙂")).toBeGreaterThan(1);
});

test("truncateUtf8FromEnd keeps valid UTF-8 boundaries", () => {
  const input = "hello🙂世界";
  const truncated = truncateUtf8FromEnd(input, 8);

  expect(truncated).toBe("...界");
  expect(truncated.includes("\uFFFD")).toBe(false);
});
