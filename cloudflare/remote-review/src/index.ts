const SESSION_STORAGE_KEY = "session";
const TOKEN_STORAGE_KEY = "github-token";
const DIRECTORY_PREFIX = "dir:";
const FILE_PREFIX = "file:";
const SESSION_TTL_SECONDS = 6 * 60 * 60;
const MAX_BLOB_BYTES = 200_000;

type RemoteReviewSessionStatus =
  | "prepared"
  | "indexed"
  | "launched"
  | "stale"
  | "failed";

type GitHubFileContext = {
  provider: "github";
  indexedAt: number;
  fileCount: number;
  expiresAt: number;
};

type RemoteReviewSession = {
  id: string;
  repo: string;
  number: number;
  headSha: string;
  status: RemoteReviewSessionStatus;
  fileContext: GitHubFileContext | null;
  createdAt: number;
  updatedAt: number;
  lastError: string | null;
};

type CachedDirectoryEntry = {
  name: string;
  path: string;
  kind: "dir" | "file";
  size: number | null;
};

type CachedFileEntry = {
  path: string;
  sha: string;
  size: number;
};

type PrepareSessionInput = {
  repo?: unknown;
  number?: unknown;
  headSha?: unknown;
  githubToken?: unknown;
};

type StatusUpdateInput = {
  status?: unknown;
  lastError?: unknown;
};

type SessionObjectEnv = Record<string, never>;

type RuntimeEnv = {
  REMOTE_REVIEW_SESSIONS: DurableObjectNamespace;
  RUDU_REMOTE_REVIEW_API_TOKEN?: string;
};

type GitHubCommitResponse = {
  commit?: {
    tree?: {
      sha?: string;
    };
  };
};

type GitHubTreeResponse = {
  truncated?: boolean;
  tree?: Array<{
    path?: string;
    type?: string;
    sha?: string;
    size?: number;
  }>;
};

type GitHubBlobResponse = {
  content?: string;
  encoding?: string;
  size?: number;
};

function jsonResponse(body: unknown, init?: ResponseInit) {
  return Response.json(body, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
}

function errorResponse(message: string, status: number) {
  return jsonResponse({ error: message }, { status });
}

function requireBearer(request: Request, env: RuntimeEnv) {
  if (!env.RUDU_REMOTE_REVIEW_API_TOKEN) {
    return errorResponse("RUDU_REMOTE_REVIEW_API_TOKEN is not configured.", 500);
  }

  const expected = `Bearer ${env.RUDU_REMOTE_REVIEW_API_TOKEN}`;
  if (request.headers.get("authorization") !== expected) {
    return errorResponse("Unauthorized.", 401);
  }

  return null;
}

function parseSessionIdPath(pathname: string, suffix = "") {
  const pattern = suffix
    ? new RegExp(`^/sessions/([^/]+)/${suffix}$`)
    : /^\/sessions\/([^/]+)$/;
  const match = pathname.match(pattern);
  if (!match) return null;
  return decodeURIComponent(match[1]);
}

function validateSessionId(sessionId: string) {
  return sessionId.length > 0 && /^[a-z0-9-]+$/.test(sessionId);
}

async function readJson<T>(request: Request): Promise<T> {
  return (await request.json().catch(() => ({}))) as T;
}

function validatePrepareSessionInput(input: PrepareSessionInput) {
  if (typeof input.repo !== "string" || !input.repo.includes("/")) {
    throw new Error("repo must be in owner/name format.");
  }

  if (typeof input.number !== "number" || !Number.isInteger(input.number) || input.number <= 0) {
    throw new Error("number must be a positive pull request number.");
  }

  if (typeof input.headSha !== "string" || input.headSha.trim().length === 0) {
    throw new Error("headSha is required.");
  }

  if (typeof input.githubToken !== "string" || input.githubToken.trim().length === 0) {
    throw new Error("githubToken is required.");
  }

  return {
    repo: input.repo.trim(),
    number: input.number,
    headSha: input.headSha.trim(),
    githubToken: input.githubToken.trim(),
  };
}

function validateStatusUpdate(input: StatusUpdateInput) {
  const statuses: RemoteReviewSessionStatus[] = [
    "prepared",
    "indexed",
    "launched",
    "stale",
    "failed",
  ];

  if (!statuses.includes(input.status as RemoteReviewSessionStatus)) {
    throw new Error("status is invalid.");
  }

  return {
    status: input.status as RemoteReviewSessionStatus,
    lastError: typeof input.lastError === "string" ? input.lastError : null,
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function shortSha(headSha: string) {
  return headSha.slice(0, 12);
}

function sessionIdFor(repo: string, number: number, headSha: string) {
  return `${slugify(repo)}-pr-${number}-${shortSha(headSha).toLowerCase()}`;
}

function nowUnixTimestamp() {
  return Math.floor(Date.now() / 1000);
}

function sessionExpiresAt(session: RemoteReviewSession) {
  return session.fileContext?.expiresAt ?? session.createdAt + SESSION_TTL_SECONDS;
}

function sessionIsExpired(session: RemoteReviewSession) {
  return nowUnixTimestamp() >= sessionExpiresAt(session);
}

async function markSessionStale(storage: DurableObjectStorage, session: RemoteReviewSession) {
  if (session.status === "stale") {
    return session;
  }

  const nextSession: RemoteReviewSession = {
    ...session,
    status: "stale",
    updatedAt: nowUnixTimestamp(),
    lastError: "Remote review session expired. Prepare the selected PR again.",
  };
  await storage.put(SESSION_STORAGE_KEY, nextSession);
  return nextSession;
}

async function createOrLoadSession(
  storage: DurableObjectStorage,
  input: ReturnType<typeof validatePrepareSessionInput>,
) {
  const expectedId = sessionIdFor(input.repo, input.number, input.headSha);
  const existing = await storage.get<RemoteReviewSession>(SESSION_STORAGE_KEY);

  if (existing) {
    if (existing.id !== expectedId) {
      throw new Error("Session Durable Object name does not match the requested PR revision.");
    }

    if (sessionIsExpired(existing)) {
      await deleteByPrefix(storage, DIRECTORY_PREFIX);
      await deleteByPrefix(storage, FILE_PREFIX);
      const now = nowUnixTimestamp();
      const refreshed: RemoteReviewSession = {
        ...existing,
        status: "prepared",
        fileContext: null,
        createdAt: now,
        updatedAt: now,
        lastError: null,
      };
      await storage.put(SESSION_STORAGE_KEY, refreshed);
      await storage.put(TOKEN_STORAGE_KEY, input.githubToken);
      return refreshed;
    }

    await storage.put(TOKEN_STORAGE_KEY, input.githubToken);
    return existing;
  }

  const now = nowUnixTimestamp();
  const session: RemoteReviewSession = {
    id: expectedId,
    repo: input.repo,
    number: input.number,
    headSha: input.headSha,
    status: "prepared",
    fileContext: null,
    createdAt: now,
    updatedAt: now,
    lastError: null,
  };

  await storage.put(SESSION_STORAGE_KEY, session);
  await storage.put(TOKEN_STORAGE_KEY, input.githubToken);
  return session;
}

async function loadSession(storage: DurableObjectStorage) {
  const session = await storage.get<RemoteReviewSession>(SESSION_STORAGE_KEY);
  if (!session) {
    throw new Response(JSON.stringify({ error: "Remote review session not found." }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  if (sessionIsExpired(session)) {
    throw new Response(
      JSON.stringify({ error: "Remote review session expired. Prepare the selected PR again." }),
      {
        status: 410,
        headers: { "content-type": "application/json" },
      },
    );
  }

  return session;
}

async function loadSessionForGet(storage: DurableObjectStorage) {
  const session = await storage.get<RemoteReviewSession>(SESSION_STORAGE_KEY);
  if (!session) {
    throw new Response(JSON.stringify({ error: "Remote review session not found." }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  if (sessionIsExpired(session)) {
    return markSessionStale(storage, session);
  }

  return session;
}

async function requireGitHubToken(storage: DurableObjectStorage) {
  const token = await storage.get<string>(TOKEN_STORAGE_KEY);
  if (!token) {
    throw new Error("GitHub token is missing for this remote review session.");
  }
  return token;
}

async function deleteByPrefix(storage: DurableObjectStorage, prefix: string) {
  const entries = await storage.list({ prefix });
  const keys = Array.from(entries.keys());
  if (keys.length > 0) {
    await storage.delete(keys);
  }
}

function normalizeTreePath(input: string | null | undefined) {
  const trimmed = (input ?? "").trim();
  if (trimmed === "" || trimmed === ".") {
    return "";
  }

  const parts = trimmed
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);

  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error("Path must stay within the indexed repository tree.");
  }

  return parts.join("/");
}

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

async function hydrateSession(storage: DurableObjectStorage) {
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

async function updateSessionStatus(
  storage: DurableObjectStorage,
  input: ReturnType<typeof validateStatusUpdate>,
) {
  const session = await loadSessionForGet(storage);
  const now = nowUnixTimestamp();
  const nextSession: RemoteReviewSession = {
    ...session,
    status: input.status,
    updatedAt: now,
    lastError: input.status === "failed" ? input.lastError : null,
  };

  await storage.put(SESSION_STORAGE_KEY, nextSession);
  return nextSession;
}

async function listDirectoryEntries(storage: DurableObjectStorage, url: URL) {
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
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("File is not valid UTF-8 text.");
  }
}

async function readIndexedFile(storage: DurableObjectStorage, url: URL) {
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

async function handleSessionObjectRequest(
  request: Request,
  storage: DurableObjectStorage,
  _env: SessionObjectEnv,
) {
  const url = new URL(request.url);

  try {
    if (request.method === "POST" && url.pathname === "/session") {
      const input = validatePrepareSessionInput(await readJson<PrepareSessionInput>(request));
      const session = await createOrLoadSession(storage, input);
      return jsonResponse(session);
    }

    if (request.method === "GET" && url.pathname === "/session") {
      return jsonResponse(await loadSessionForGet(storage));
    }

    if (request.method === "POST" && url.pathname === "/hydrate") {
      return jsonResponse(await hydrateSession(storage));
    }

    if (request.method === "GET" && url.pathname === "/files") {
      return jsonResponse(await listDirectoryEntries(storage, url));
    }

    if (request.method === "GET" && url.pathname === "/file") {
      return jsonResponse(await readIndexedFile(storage, url));
    }

    if (request.method === "POST" && url.pathname === "/status") {
      const input = validateStatusUpdate(await readJson<StatusUpdateInput>(request));
      return jsonResponse(await updateSessionStatus(storage, input));
    }

    return errorResponse("Not found.", 404);
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(message, 400);
  }
}

function sessionStub(env: RuntimeEnv, sessionId: string) {
  const objectId = env.REMOTE_REVIEW_SESSIONS.idFromName(sessionId);
  return env.REMOTE_REVIEW_SESSIONS.get(objectId);
}

function forwardToSessionObject(
  stub: DurableObjectStub,
  pathnameWithSearch: string,
  request: Request,
  body?: BodyInit,
) {
  return stub.fetch(
    new Request(`https://session.local${pathnameWithSearch}`, {
      method: request.method,
      body,
      headers: body ? { "content-type": "application/json" } : undefined,
    }),
  );
}

async function handleWorkerRequest(request: Request, env: RuntimeEnv) {
  const authError = requireBearer(request, env);
  if (authError) return authError;

  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/sessions") {
    const input = validatePrepareSessionInput(await readJson<PrepareSessionInput>(request));
    const sessionId = sessionIdFor(input.repo, input.number, input.headSha);
    const stub = sessionStub(env, sessionId);
    return forwardToSessionObject(stub, "/session", request, JSON.stringify(input));
  }

  const sessionId =
    parseSessionIdPath(url.pathname) ??
    parseSessionIdPath(url.pathname, "hydrate") ??
    parseSessionIdPath(url.pathname, "status") ??
    parseSessionIdPath(url.pathname, "files") ??
    parseSessionIdPath(url.pathname, "file");

  if (!sessionId || !validateSessionId(sessionId)) {
    return errorResponse("Not found.", 404);
  }

  const stub = sessionStub(env, sessionId);

  if (request.method === "GET" && parseSessionIdPath(url.pathname) === sessionId) {
    return forwardToSessionObject(stub, "/session", request);
  }

  if (request.method === "POST" && parseSessionIdPath(url.pathname, "hydrate") === sessionId) {
    return forwardToSessionObject(stub, "/hydrate", request);
  }

  if (request.method === "POST" && parseSessionIdPath(url.pathname, "status") === sessionId) {
    return forwardToSessionObject(stub, "/status", request, await request.text());
  }

  if (request.method === "GET" && parseSessionIdPath(url.pathname, "files") === sessionId) {
    return forwardToSessionObject(stub, `/files${url.search}`, request);
  }

  if (request.method === "GET" && parseSessionIdPath(url.pathname, "file") === sessionId) {
    return forwardToSessionObject(stub, `/file${url.search}`, request);
  }

  return errorResponse("Not found.", 404);
}

export class RemoteReviewSessionObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: SessionObjectEnv,
  ) {}

  fetch(request: Request) {
    return handleSessionObjectRequest(request, this.state.storage, this.env);
  }
}

export default {
  fetch(request, env) {
    return handleWorkerRequest(request, env as RuntimeEnv);
  },
} satisfies ExportedHandler<RuntimeEnv>;

export { handleSessionObjectRequest, handleWorkerRequest, sessionIdFor };
export type {
  CachedDirectoryEntry,
  CachedFileEntry,
  GitHubFileContext,
  RemoteReviewSession,
  SessionObjectEnv,
};
