import type { SessionLogLine, SessionLogSummary } from "./types.js";
import { truncateUtf8FromEnd, utf8ByteLength } from "./text.js";

interface InternalLogLine extends SessionLogLine {
  bytes: number;
}

export class SessionLogRingBuffer {
  private entries: InternalLogLine[] = [];
  private retainedBytes = 0;
  private droppedLines = 0;

  constructor(private maxLines: number, private maxBytes: number) {}

  append(lines: readonly SessionLogLine[]): SessionLogSummary {
    for (const line of lines) {
      let text = line.text;
      let bytes = utf8ByteLength(text) + 1;
      if (bytes > this.maxBytes) {
        text = truncateUtf8FromEnd(text, Math.max(1, this.maxBytes - 1));
        bytes = utf8ByteLength(text) + 1;
      }
      this.entries.push({ timestamp: line.timestamp, stream: line.stream, text, bytes });
      this.retainedBytes += bytes;
    }

    while (this.entries.length > this.maxLines || this.retainedBytes > this.maxBytes) {
      const removed = this.entries.shift();
      if (!removed) break;
      this.retainedBytes -= removed.bytes;
      this.droppedLines += 1;
    }

    return this.getSummary();
  }

  snapshot(): readonly SessionLogLine[] {
    return this.entries.map(({ bytes, ...line }) => ({ ...line }));
  }

  getSummary(): SessionLogSummary {
    return {
      retainedLines: this.entries.length,
      retainedBytes: this.retainedBytes,
      droppedLines: this.droppedLines,
    };
  }
}
