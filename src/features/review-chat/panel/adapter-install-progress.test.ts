import { describe, expect, it } from "bun:test";
import {
  formatAdapterInstallProgress,
  getAdapterInstallProgressValue,
  isAdapterInstallRunning,
} from "./adapter-install-progress";
import type { ReviewChatAdapterInstallEvent } from "../../../types/github";

function event(
  overrides: Partial<ReviewChatAdapterInstallEvent>,
): ReviewChatAdapterInstallEvent {
  return {
    phase: "downloading",
    downloadedBytes: 0,
    totalBytes: null,
    version: "v0.14.0",
    message: "Downloading Codex ACP adapter",
    ...overrides,
  };
}

describe("adapter install progress", () => {
  it("formats determinate progress as a percentage", () => {
    const progress = event({ downloadedBytes: 25, totalBytes: 100 });

    expect(getAdapterInstallProgressValue(progress)).toBe(25);
    expect(formatAdapterInstallProgress(progress)).toBe("25%");
  });

  it("uses indeterminate progress when total bytes are unknown", () => {
    const progress = event({ downloadedBytes: 4096, totalBytes: null });

    expect(getAdapterInstallProgressValue(progress)).toBeNull();
    expect(formatAdapterInstallProgress(progress)).toBe("4 KB");
  });

  it("detects running phases", () => {
    expect(isAdapterInstallRunning(event({ phase: "checking" }))).toBe(true);
    expect(isAdapterInstallRunning(event({ phase: "extracting" }))).toBe(true);
    expect(isAdapterInstallRunning(event({ phase: "ready" }))).toBe(false);
    expect(isAdapterInstallRunning(null)).toBe(false);
  });
});
