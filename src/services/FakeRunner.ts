import type { SessionManager, QueueSessionInput } from "./SessionManager.js";

export interface FakeRunnerOptions {
  minDurationMs?: number;
  maxDurationMs?: number;
  successRate?: number; // 0-1 probability of success
  linesPerSecond?: number;
}

export class FakeRunner {
  private readonly minDurationMs: number;
  private readonly maxDurationMs: number;
  private readonly successRate: number;
  private readonly linesPerSecond: number;

  constructor(private readonly sessionManager: SessionManager, options: FakeRunnerOptions = {}) {
    this.minDurationMs = options.minDurationMs ?? 3000;
    this.maxDurationMs = options.maxDurationMs ?? 10000;
    this.successRate = options.successRate ?? 0.8;
    this.linesPerSecond = options.linesPerSecond ?? 5;
  }

  createSession(prompt: string): string {
    const duration = this.randomDuration();
    const willSucceed = Math.random() < this.successRate;

    const input: QueueSessionInput = {
      title: prompt.slice(0, 50) + (prompt.length > 50 ? "..." : ""),
      command: ["echo", "fake-runner"],
      metadata: {
        prompt,
        fake: true,
        expectedDuration: duration,
        willSucceed,
      },
    };

    const snapshot = this.sessionManager.queueSession(input);

    // Start fake simulation
    this.simulateSession(snapshot.id, prompt, duration, willSucceed);

    return snapshot.id;
  }

  private async simulateSession(
    sessionId: string,
    prompt: string,
    duration: number,
    willSucceed: boolean,
  ): Promise<void> {
    const startTime = Date.now();
    const logInterval = 1000 / this.linesPerSecond;

    // Simulate log output
    const logLines = [
      `Initializing coding session for: ${prompt.slice(0, 30)}...`,
      "Loading context...",
      "Analyzing requirements...",
      "Planning implementation...",
      "Generating code...",
      "Reviewing changes...",
      "Running tests...",
      "Finalizing output...",
    ];

    let lineIndex = 0;

    const intervalId = setInterval(() => {
      if (lineIndex < logLines.length) {
        // In a real implementation, we'd emit log events here
        // For now, the SessionManager will handle stdout from the subprocess
        lineIndex++;
      }
    }, logInterval);

    // Wait for duration
    await sleep(duration);

    clearInterval(intervalId);

    // The session will be finalized by the SessionManager when the subprocess exits
    // This is just for simulation purposes
  }

  private randomDuration(): number {
    return Math.floor(
      Math.random() * (this.maxDurationMs - this.minDurationMs) + this.minDurationMs
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
