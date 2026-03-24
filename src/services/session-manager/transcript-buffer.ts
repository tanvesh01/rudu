import type { TranscriptMessage } from "../../domain/transcript.js";
import type { TranscriptSummary } from "./types.js";
import { truncateUtf8FromEnd, utf8ByteLength } from "./text.js";

interface InternalTranscriptMessage extends TranscriptMessage {
  bytes: number;
}

export class TranscriptRingBuffer {
  private entries: InternalTranscriptMessage[] = [];
  private retainedBytes = 0;
  private droppedMessages = 0;

  constructor(private maxLines: number = 1000, private maxBytes: number = 500000) {}

  append(message: TranscriptMessage): TranscriptSummary {
    let text = message.text ?? "";
    let bytes = utf8ByteLength(text) + 1;
    if (bytes > this.maxBytes) {
      text = truncateUtf8FromEnd(text, Math.max(1, this.maxBytes - 1));
      bytes = utf8ByteLength(text) + 1;
    }

    this.entries.push({ ...message, text, bytes });
    this.retainedBytes += bytes;

    while (this.entries.length > this.maxLines || this.retainedBytes > this.maxBytes) {
      const removed = this.entries.shift();
      if (!removed) break;
      this.retainedBytes -= removed.bytes;
      this.droppedMessages += 1;
    }

    return this.getSummary();
  }

  snapshot(): readonly TranscriptMessage[] {
    return this.entries.map(({ bytes, ...message }) => ({ ...message }));
  }

  getSummary(): TranscriptSummary {
    return {
      retainedMessages: this.entries.length,
      retainedBytes: this.retainedBytes,
      droppedMessages: this.droppedMessages,
    };
  }

  update(message: TranscriptMessage): void {
    const index = this.entries.findIndex((entry) => entry.id === message.id);
    if (index === -1) return;

    const old = this.entries[index]!;
    let text = message.text ?? "";
    let bytes = utf8ByteLength(text) + 1;
    if (bytes > this.maxBytes) {
      text = truncateUtf8FromEnd(text, Math.max(1, this.maxBytes - 1));
      bytes = utf8ByteLength(text) + 1;
    }

    this.entries[index] = { ...message, text, bytes };
    this.retainedBytes += bytes - old.bytes;
  }
}
