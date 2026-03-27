import { spawnSync } from "child_process";

export type StartupPreflightResult =
  | { type: "ready" }
  | {
      type: "blocked";
      title: string;
      reason: string;
      suggestion: string;
    };

function commandExists(command: string): boolean {
  const result = spawnSync(command, ["--version"], {
    stdio: "ignore",
    timeout: 5000,
  });
  return result.status === 0;
}

function piHasConfiguredModels(): boolean {
  const result = spawnSync("pi", ["--list-models"], {
    encoding: "utf-8",
    timeout: 10000,
  });

  if (result.status !== 0) {
    return false;
  }

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

  const lines = output
    .split(/\r?\n/g)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  return lines.some((line) => /^[-\w]+\s+\S+\s+\S+/.test(line));
}

export function detectStartupPreflight(): StartupPreflightResult {
  if (!commandExists("git")) {
    return {
      type: "blocked",
      title: "Git Required",
      reason: "Git is not available on your PATH.",
      suggestion: "Install Git, then relaunch Rudu.",
    };
  }

  if (!commandExists("pi")) {
    return {
      type: "blocked",
      title: "Pi Required",
      reason: "Pi CLI is not available on your PATH.",
      suggestion: "Install Pi, then relaunch Rudu.",
    };
  }

  if (!piHasConfiguredModels()) {
    return {
      type: "blocked",
      title: "Pi Needs Models",
      reason: "Pi is installed, but no usable models are configured yet.",
      suggestion: "Run 'pi', log in or add a provider, choose a model, then relaunch Rudu.",
    };
  }

  return { type: "ready" };
}
