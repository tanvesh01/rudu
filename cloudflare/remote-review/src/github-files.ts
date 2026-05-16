import {
  DIRECTORY_PREFIX,
  FILE_PREFIX,
  MAX_BLOB_BYTES,
  SESSION_STORAGE_KEY,
  SESSION_TTL_SECONDS,
} from "./constants";
import { normalizeTreePath } from "./paths";
import {
  deleteByPrefix,
  loadSession,
  nowUnixTimestamp,
  requireGitHubToken,
} from "./session-store";
import type {
  CachedDirectoryEntry,
  CachedFileEntry,
  GitHubBlobResponse,
  GitHubCommitResponse,
  GitHubTreeResponse,
  RemoteReviewSession,
} from "./types";

function directoryKey(path: string) {
  return `${DIRECTORY_PREFIX}${path}`;
}

function fileKey(path: string) {
  return `${FILE_PREFIX}${path}`;
}

function parentDirectory(path: string) {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function entryName(path: string) {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

function ensureDirectoryList(map: Map<string, Map<string, CachedDirectoryEntry>>, path: string) {
  if (!map.has(path)) {
    map.set(path, new Map());
  }
  return map.get(path)!;
}

function registerDirectoryEntry(
  map: Map<string, Map<string, CachedDirectoryEntry>>,
  path: string,
) {
  const normalizedPath = normalizeTreePath(path);
  const current = ensureDirectoryList(map, normalizedPath);
  void current;

  if (normalizedPath === "") {
    return;
  }

  const parent = parentDirectory(normalizedPath);
  ensureDirectoryList(map, parent).set(normalizedPath, {
    name: entryName(normalizedPath),
    path: normalizedPath,
    kind: "dir",
    size: null,
  });
}

function registerFileEntry(
  directories: Map<string, Map<string, CachedDirectoryEntry>>,
  files: Map<string, CachedFileEntry>,
  path: string,
  sha: string,
  size: number,
) {
  const normalizedPath = normalizeTreePath(path);
  const parent = parentDirectory(normalizedPath);
  registerDirectoryEntry(directories, parent);
  ensureDirectoryList(directories, parent).set(normalizedPath, {
    name: entryName(normalizedPath),
    path: normalizedPath,
    kind: "file",
    size,
  });
  files.set(normalizedPath, {
    path: normalizedPath,
    sha,
    size,
  });
}

async function githubJson<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "rudu-remote-review-worker",
      "x-github-api-version": "2022-11-28",
    },
  });

  const text = await response.text();
  if (!response.ok) {
    const message = text
      ? (() => {
          try {
            const parsed = JSON.parse(text) as { message?: string };
            return parsed.message ?? text;
          } catch {
            return text;
          }
        })()
      : `GitHub returned HTTP ${response.status}.`;
    throw new Error(`GitHub API request failed: ${message}`);
  }

  return JSON.parse(text) as T;
}

export async function hydrateSession(storage: DurableObjectStorage) {
  const session = await loadSession(storage);
  const token = await requireGitHubToken(storage);
  const [owner, repo] = session.repo.split("/", 2);

  const commit = await githubJson<GitHubCommitResponse>(
    token,
    `/repos/${owner}/${repo}/commits/${encodeURIComponent(session.headSha)}`,
  );
  const treeSha = commit.commit?.tree?.sha;
  if (!treeSha) {
    throw new Error("GitHub commit payload did not include a tree SHA.");
  }

  const tree = await githubJson<GitHubTreeResponse>(
    token,
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`,
  );

  if (tree.truncated) {
    throw new Error("GitHub tree response was truncated. This PR is too large for remote review v1.");
  }

  await deleteByPrefix(storage, DIRECTORY_PREFIX);
  await deleteByPrefix(storage, FILE_PREFIX);

  const directories = new Map<string, Map<string, CachedDirectoryEntry>>();
  const files = new Map<string, CachedFileEntry>();
  ensureDirectoryList(directories, "");

  for (const item of tree.tree ?? []) {
    if (typeof item.path !== "string" || item.path.trim() === "") {
      continue;
    }

    if (item.type === "tree") {
      registerDirectoryEntry(directories, item.path);
      continue;
    }

    if (item.type === "blob" && typeof item.sha === "string") {
      registerFileEntry(
        directories,
        files,
        item.path,
        item.sha,
        typeof item.size === "number" ? item.size : 0,
      );
    }
  }

  const puts: Record<string, CachedDirectoryEntry[] | CachedFileEntry> = {};
  for (const [path, entries] of directories) {
    puts[directoryKey(path)] = Array.from(entries.values()).sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "dir" ? -1 : 1;
      }
      return left.path.localeCompare(right.path);
    });
  }
  for (const [path, file] of files) {
    puts[fileKey(path)] = file;
  }
  await storage.put(puts);

  const now = nowUnixTimestamp();
  const nextSession: RemoteReviewSession = {
    ...session,
    status: "indexed",
    fileContext: {
      provider: "github",
      indexedAt: now,
      fileCount: files.size,
      expiresAt: now + SESSION_TTL_SECONDS,
    },
    updatedAt: now,
    lastError: null,
  };

  await storage.put(SESSION_STORAGE_KEY, nextSession);
  return nextSession;
}

export async function listDirectoryEntries(storage: DurableObjectStorage, url: URL) {
  const session = await loadSession(storage);
  if (!session.fileContext) {
    throw new Error("Hydrate the remote review session before listing files.");
  }

  const path = normalizeTreePath(url.searchParams.get("path"));
  const entries = await storage.get<CachedDirectoryEntry[]>(directoryKey(path));
  if (!entries) {
    throw new Error(`Directory not found in indexed tree: ${path || "."}`);
  }

  return {
    path: path || ".",
    entries,
  };
}

function decodeBase64(content: string) {
  const clean = content.replace(/\s+/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodeUtf8Text(bytes: Uint8Array) {
  if (bytes.includes(0)) {
    throw new Error("Binary files are not supported by remote review.");
  }

  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new Error("File is not valid UTF-8 text.");
  }
}

export async function readIndexedFile(storage: DurableObjectStorage, url: URL) {
  const session = await loadSession(storage);
  if (!session.fileContext) {
    throw new Error("Hydrate the remote review session before reading files.");
  }

  const path = normalizeTreePath(url.searchParams.get("path"));
  if (!path) {
    throw new Error("A file path is required.");
  }

  const file = await storage.get<CachedFileEntry>(fileKey(path));
  if (!file) {
    const directory = await storage.get<CachedDirectoryEntry[]>(directoryKey(path));
    if (directory) {
      throw new Error(`Path is a directory, not a file: ${path}`);
    }
    throw new Error(`File not found in indexed tree: ${path}`);
  }

  if (file.size > MAX_BLOB_BYTES) {
    throw new Error(
      `File is too large for remote review (${file.size} bytes, limit ${MAX_BLOB_BYTES}).`,
    );
  }

  const token = await requireGitHubToken(storage);
  const [owner, repo] = session.repo.split("/", 2);
  const blob = await githubJson<GitHubBlobResponse>(
    token,
    `/repos/${owner}/${repo}/git/blobs/${encodeURIComponent(file.sha)}`,
  );

  if (blob.encoding !== "base64" || typeof blob.content !== "string") {
    throw new Error("GitHub blob payload was missing base64 file content.");
  }

  if (typeof blob.size === "number" && blob.size > MAX_BLOB_BYTES) {
    throw new Error(
      `File is too large for remote review (${blob.size} bytes, limit ${MAX_BLOB_BYTES}).`,
    );
  }

  const text = decodeUtf8Text(decodeBase64(blob.content));
  const lines = text.split("\n");
  const requestedStart = Number(url.searchParams.get("startLine") ?? "1");
  const requestedEnd = Number(url.searchParams.get("endLine") ?? String(lines.length));
  const startLine = Number.isInteger(requestedStart) && requestedStart > 0 ? requestedStart : 1;
  const endLine =
    Number.isInteger(requestedEnd) && requestedEnd >= startLine
      ? Math.min(requestedEnd, lines.length)
      : lines.length;

  return {
    path,
    startLine,
    endLine,
    totalLines: lines.length,
    body: lines
      .slice(startLine - 1, endLine)
      .map((line, index) => `${startLine + index}: ${line}`)
      .join("\n"),
  };
}
