import type {
  SessionId,
  SessionLogLine,
  SessionRuntime,
} from "./types.js";

interface StartProcessSessionInput {
  sessionId: SessionId;
  command: string[];
  cwd?: string;
  env?: Record<string, string>;
}

interface ProcessRunnerOptions {
  now: () => number;
  onLogLines: (sessionId: SessionId, lines: readonly SessionLogLine[]) => void;
  onExit: (
    sessionId: SessionId,
    result: {
      exitCode: number | null;
      signalCode: string | null;
      cancelled: boolean;
    },
  ) => void;
}

export class ProcessSessionRunner {
  constructor(private options: ProcessRunnerOptions) {}

  start(input: StartProcessSessionInput): {
    pid: number;
    runtime: SessionRuntime;
  } {
    const abortController = new AbortController();
    const subprocess = Bun.spawn({
      cmd: input.command,
      cwd: input.cwd,
      env: input.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      signal: abortController.signal,
    });

    const runtime: SessionRuntime = {
      subprocess,
      abortController,
      stdoutTask: this.consumeStream(input.sessionId, "stdout", subprocess.stdout),
      stderrTask: this.consumeStream(input.sessionId, "stderr", subprocess.stderr),
      killEscalationTimer: null,
      cancelRequested: false,
    };

    void this.observeExit(input.sessionId, runtime);

    return {
      pid: subprocess.pid,
      runtime,
    };
  }

  private async observeExit(
    sessionId: SessionId,
    runtime: SessionRuntime,
  ): Promise<void> {
    let exitCode: number | null = null;
    try {
      exitCode = await runtime.subprocess.exited;
    } catch {
      exitCode = runtime.subprocess.exitCode;
    }

    const signalCode = runtime.subprocess.signalCode ?? null;
    await Promise.allSettled([runtime.stdoutTask, runtime.stderrTask]);

    this.options.onExit(sessionId, {
      exitCode: exitCode ?? runtime.subprocess.exitCode ?? null,
      signalCode,
      cancelled: runtime.cancelRequested,
    });
  }

  private async consumeStream(
    sessionId: SessionId,
    stream: "stdout" | "stderr",
    readable: ReadableStream<Uint8Array> | undefined,
  ): Promise<void> {
    if (!readable) return;

    const reader = readable.pipeThrough(new TextDecoderStream()).getReader();
    let pending = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;

        const chunk = pending + value;
        const parts = chunk.split(/\r?\n/g);
        pending = parts.pop() ?? "";

        if (parts.length > 0) {
          this.options.onLogLines(
            sessionId,
            parts.map((text) => ({
              timestamp: this.options.now(),
              stream,
              text,
            })),
          );
        }
      }

      if (pending.length > 0) {
        this.options.onLogLines(sessionId, [
          {
            timestamp: this.options.now(),
            stream,
            text: pending,
          },
        ]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.onLogLines(sessionId, [
        {
          timestamp: this.options.now(),
          stream: "system",
          text: `[session-manager] ${stream} stream error: ${message}`,
        },
      ]);
    } finally {
      reader.releaseLock();
    }
  }
}
