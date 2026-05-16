import { lstat, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const MAX_TEXT_BYTES = 50_000;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function truncateText(text: string): string {
  const bytes = Buffer.byteLength(text);
  if (bytes <= MAX_TEXT_BYTES) return text;
  return `${text.slice(0, MAX_TEXT_BYTES)}\n\n[Output truncated at ${MAX_TEXT_BYTES} bytes from ${bytes} bytes.]`;
}

function repoRoot(): string {
  return resolve(requiredEnv("RUDU_REVIEW_WORKSPACE_REPO_PATH"));
}

async function resolveRepoPath(
  pathname: string | undefined,
): Promise<{ absolutePath: string; displayPath: string }> {
  const root = await realpath(repoRoot());
  const requested = pathname && pathname.trim().length > 0 ? pathname : ".";
  const absolutePath = resolve(root, requested);
  const realTargetPath = await realpath(absolutePath);
  const relativePath = relative(root, realTargetPath);

  if (relativePath === ".." || relativePath.startsWith(`..${"/"}`)) {
    throw new Error("Path escapes the review workspace.");
  }

  return {
    absolutePath: realTargetPath,
    displayPath: relativePath.length > 0 ? relativePath : ".",
  };
}

function lineSlice(text: string, startLine?: number, endLine?: number) {
  const lines = text.split(/\r?\n/);
  const totalLines = lines.length;
  const start = Math.max(1, Math.floor(startLine ?? 1));
  const end = Math.min(totalLines, Math.floor(endLine ?? totalLines));
  const body = lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`).join("\n");
  return { body, startLine: start, endLine: end, totalLines };
}

function rejectBinary(text: string) {
  if (text.includes("\0")) {
    throw new Error("Refusing to read a binary file from the review workspace.");
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "read",
    label: "Read",
    description: "Read a file from the local PR worktree.",
    promptSnippet: "Read file contents from the local PR worktree.",
    promptGuidelines: ["Use read to inspect files from the local PR worktree."],
    parameters: Type.Object({
      path: Type.String(),
      startLine: Type.Optional(Type.Number()),
      endLine: Type.Optional(Type.Number()),
    }),
    async execute(_id, params) {
      const target = await resolveRepoPath(params.path);
      const fileStat = await stat(target.absolutePath);
      if (!fileStat.isFile()) {
        throw new Error(`${target.displayPath} is not a file.`);
      }
      const text = await readFile(target.absolutePath, "utf8");
      rejectBinary(text);
      const file = lineSlice(text, params.startLine, params.endLine);
      return {
        content: [{ type: "text", text: truncateText(file.body) }],
        details: {
          path: target.displayPath,
          startLine: file.startLine,
          endLine: file.endLine,
          totalLines: file.totalLines,
        },
      };
    },
  });

  pi.registerTool({
    name: "ls",
    label: "List",
    description: "List directory entries from the local PR worktree.",
    promptSnippet: "List directory entries from the local PR worktree.",
    parameters: Type.Object({ path: Type.Optional(Type.String()) }),
    async execute(_id, params) {
      const target = await resolveRepoPath(params.path);
      const dirStat = await stat(target.absolutePath);
      if (!dirStat.isDirectory()) {
        throw new Error(`${target.displayPath} is not a directory.`);
      }

      const entries = await readdir(target.absolutePath, { withFileTypes: true });
      const lines = await Promise.all(
        entries.map(async (entry) => {
          const entryPath = resolve(target.absolutePath, entry.name);
          const entryRelative =
            target.displayPath === "." ? entry.name : `${target.displayPath}/${entry.name}`;
          const entryStat = await lstat(entryPath);
          const kind = entry.isDirectory() ? "dir " : "file";
          const size = entry.isDirectory() ? "" : ` (${entryStat.size} bytes)`;
          return `${kind} ${entryRelative}${size}`;
        }),
      );

      return {
        content: [{ type: "text", text: lines.join("\n") || "(empty)" }],
        details: { path: target.displayPath, entries: entries.length },
      };
    },
  });

  pi.registerTool({
    name: "get_pr_diff",
    label: "PR Diff",
    description: "Read the pull request diff snapshot captured by Rudu.",
    promptSnippet: "Read the selected PR diff snapshot.",
    parameters: Type.Object({}),
    async execute() {
      const text = await readFile(requiredEnv("RUDU_REVIEW_DIFF_PATH"), "utf8");
      return { content: [{ type: "text", text: truncateText(text) }], details: {} };
    },
  });

  pi.registerTool({
    name: "get_changed_files",
    label: "Changed Files",
    description: "Read the selected PR changed-file list captured by Rudu.",
    promptSnippet: "Read the changed file list for the selected PR.",
    parameters: Type.Object({}),
    async execute() {
      const text = await readFile(requiredEnv("RUDU_REVIEW_CHANGED_FILES_PATH"), "utf8");
      return { content: [{ type: "text", text: text.trim() || "No changed files." }], details: {} };
    },
  });

  pi.registerTool({
    name: "save_review_report",
    label: "Save Report",
    description: "Save the final Markdown review report for Rudu to display.",
    promptSnippet: "Save the final review report.",
    parameters: Type.Object({ body: Type.String() }),
    async execute(_id, params) {
      await writeFile(requiredEnv("RUDU_REVIEW_REPORT_PATH"), params.body, "utf8");
      return { content: [{ type: "text", text: "Review report saved." }], details: {} };
    },
  });

  pi.on("before_agent_start", async (event) => {
    return {
      systemPrompt:
        event.systemPrompt +
        "\n\nRudu review mode: the active repo context comes from a read-only local PR worktree. Use get_pr_diff, get_changed_files, ls, and read. Do not edit files, write files outside save_review_report, install dependencies, start servers, run project commands, or run shell commands.",
    };
  });
}
