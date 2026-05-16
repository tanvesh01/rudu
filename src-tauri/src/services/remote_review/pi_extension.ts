import { readFile, writeFile } from "node:fs/promises";
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

function sessionPath(pathname: string): string {
  const sessionId = encodeURIComponent(requiredEnv("RUDU_REMOTE_REVIEW_SESSION_ID"));
  return `/sessions/${sessionId}${pathname}`;
}

async function workerJson<T>(pathname: string): Promise<T> {
  const workerUrl = requiredEnv("RUDU_REMOTE_REVIEW_WORKER_URL").replace(/\/+$/, "");
  const apiToken = requiredEnv("RUDU_REMOTE_REVIEW_API_TOKEN");
  const response = await fetch(`${workerUrl}${pathname}`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiToken}`,
    },
  });
  const text = await response.text();
  if (!response.ok) {
    let message = text;
    if (text) {
      try {
        const parsed = JSON.parse(text) as { error?: string };
        message = parsed.error ?? text;
      } catch {
        message = text;
      }
    }
    throw new Error(message || `Worker request failed with HTTP ${response.status}`);
  }
  return JSON.parse(text) as T;
}

type DirectoryEntry = {
  name: string;
  path: string;
  kind: "dir" | "file";
  size: number | null;
};

type FilesResponse = {
  path: string;
  entries: DirectoryEntry[];
};

type FileResponse = {
  path: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  body: string;
};

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "read",
    label: "Read",
    description: "Read a file from the Worker-indexed GitHub PR tree.",
    promptSnippet: "Read file contents from the remote PR file tree.",
    promptGuidelines: ["Use read to inspect files from the remote PR file tree."],
    parameters: Type.Object({
      path: Type.String(),
      startLine: Type.Optional(Type.Number()),
      endLine: Type.Optional(Type.Number()),
    }),
    async execute(_id, params) {
      const search = new URLSearchParams({ path: params.path });
      if (typeof params.startLine === "number") {
        search.set("startLine", String(params.startLine));
      }
      if (typeof params.endLine === "number") {
        search.set("endLine", String(params.endLine));
      }
      const file = await workerJson<FileResponse>(sessionPath(`/file?${search.toString()}`));
      return {
        content: [{ type: "text", text: truncateText(file.body) }],
        details: {
          path: file.path,
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
    description: "List directory entries from the Worker-indexed GitHub PR tree.",
    promptSnippet: "List directory entries from the remote PR file tree.",
    parameters: Type.Object({ path: Type.Optional(Type.String()) }),
    async execute(_id, params) {
      const search = new URLSearchParams({
        path: params.path && params.path.trim().length > 0 ? params.path : ".",
      });
      const result = await workerJson<FilesResponse>(sessionPath(`/files?${search.toString()}`));
      const lines = result.entries.map((entry) =>
        `${entry.kind === "dir" ? "dir " : "file"} ${entry.path}${entry.size === null ? "" : ` (${entry.size} bytes)`}`,
      );
      return {
        content: [{ type: "text", text: lines.join("\n") || "(empty)" }],
        details: { path: result.path, entries: result.entries.length },
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
      const text = await readFile(requiredEnv("RUDU_REMOTE_REVIEW_DIFF_PATH"), "utf8");
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
      const text = await readFile(requiredEnv("RUDU_REMOTE_REVIEW_CHANGED_FILES_PATH"), "utf8");
      return { content: [{ type: "text", text: text.trim() || "No changed files." }], details: {} };
    },
  });

  pi.registerTool({
    name: "save_remote_review_report",
    label: "Save Report",
    description: "Save the final Markdown review report for Rudu to display.",
    promptSnippet: "Save the final remote review report.",
    parameters: Type.Object({ body: Type.String() }),
    async execute(_id, params) {
      await writeFile(requiredEnv("RUDU_REMOTE_REVIEW_REPORT_PATH"), params.body, "utf8");
      return { content: [{ type: "text", text: "Remote review report saved." }], details: {} };
    },
  });

  pi.on("before_agent_start", async (event) => {
    return {
      systemPrompt:
        event.systemPrompt +
        "\n\nRudu remote review mode: the active repo context comes from a read-only Worker-indexed GitHub file tree. Use get_pr_diff, get_changed_files, ls, and read. Do not edit files, write files outside save_remote_review_report, or run shell commands.",
    };
  });
}
