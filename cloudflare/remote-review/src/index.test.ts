import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  handleConfigObjectRequest,
  handleSessionObjectRequest,
  handleWorkerRequest,
  sessionIdFor,
} from "./index";

function makeStorage() {
  const values = new Map<string, unknown>();
  return {
    values,
    async get<T>(key: string) {
      return values.get(key) as T | undefined;
    },
    async put<T>(
      keyOrEntries: string | Record<string, T>,
      value?: T,
    ) {
      if (typeof keyOrEntries === "string") {
        values.set(keyOrEntries, value);
        return;
      }

      for (const [key, entry] of Object.entries(keyOrEntries)) {
        values.set(key, entry);
      }
    },
    async delete(keyOrKeys: string | string[]) {
      if (Array.isArray(keyOrKeys)) {
        for (const key of keyOrKeys) {
          values.delete(key);
        }
        return true;
      }

      return values.delete(keyOrKeys);
    },
    async list({ prefix }: { prefix?: string } = {}) {
      const entries = new Map<string, unknown>();
      for (const [key, value] of values.entries()) {
        if (!prefix || key.startsWith(prefix)) {
          entries.set(key, value);
        }
      }
      return entries;
    },
    async transaction<T>(closure: (txn: typeof this) => Promise<T>) {
      return closure(this);
    },
  };
}

function sessionRequest(path: string, method: string, body?: unknown) {
  return new Request(`https://session.local${path}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { "content-type": "application/json" } : undefined,
  });
}

function workerRequest(path: string, method = "GET", body?: unknown, apiToken?: string) {
  return new Request(`https://remote-review.example${path}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(apiToken ? { authorization: `Bearer ${apiToken}` } : {}),
    },
  });
}

function makeConfigNamespace(storage = makeStorage()) {
  return {
    idFromName(name: string) {
      return name;
    },
    get() {
      return {
        fetch(request: Request) {
          return handleConfigObjectRequest(request, storage as never);
        },
      };
    },
  } as never;
}

function makeRuntimeEnv(
  options: {
    apiToken?: string;
    configStorage?: ReturnType<typeof makeStorage>;
  } = {},
) {
  return {
    REMOTE_REVIEW_CONFIG: makeConfigNamespace(options.configStorage),
    REMOTE_REVIEW_SESSIONS: {} as never,
    ...(options.apiToken
      ? { RUDU_REMOTE_REVIEW_API_TOKEN: options.apiToken }
      : {}),
  };
}

function textToBase64(text: string) {
  return Buffer.from(text, "utf8").toString("base64");
}

function installGithubFetchMock() {
  const fetchMock = mock(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.includes("/commits/abc123")) {
      return Response.json({
        commit: {
          tree: {
            sha: "tree-1",
          },
        },
      });
    }

    if (url.includes("/git/trees/tree-1")) {
      return Response.json({
        truncated: false,
        tree: [
          { path: "README.md", type: "blob", sha: "blob-readme", size: 18 },
          { path: "src", type: "tree", sha: "tree-src" },
          { path: "src/index.ts", type: "blob", sha: "blob-index", size: 31 },
          { path: "src/utils", type: "tree", sha: "tree-utils" },
          { path: "src/utils/math.ts", type: "blob", sha: "blob-math", size: 24 },
        ],
      });
    }

    if (url.includes("/git/blobs/blob-index")) {
      return Response.json({
        encoding: "base64",
        size: 31,
        content: textToBase64("const one = 1;\nconst two = 2;\n"),
      });
    }

    if (url.includes("/git/blobs/blob-readme")) {
      return Response.json({
        encoding: "base64",
        size: 18,
        content: textToBase64("# Rudu\nhello world\n"),
      });
    }

    if (url.includes("/git/blobs/blob-binary")) {
      return Response.json({
        encoding: "base64",
        size: 4,
        content: "AAEC",
      });
    }

    return new Response(
      JSON.stringify({
        message: `Unexpected URL ${url}`,
      }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
  });

  globalThis.fetch = fetchMock as typeof fetch;
  return fetchMock;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("remote-review Worker", () => {
  it("keys sessions by repo, pull request number, and short head sha", () => {
    expect(sessionIdFor("Owner/Repo.Name", 42, "ABCDEF0123456789")).toBe(
      "owner-repo-name-pr-42-abcdef012345",
    );
  });

  it("stores the GitHub token privately and does not return it in the session response", async () => {
    const storage = makeStorage();

    const response = await handleSessionObjectRequest(
      sessionRequest("/session", "POST", {
        repo: "tanvesh/rudu",
        number: 7,
        headSha: "abc123",
        githubToken: "gho_secret",
      }),
      storage as never,
      {},
    );

    const json = await response.json();
    expect(json).toMatchObject({
      id: "tanvesh-rudu-pr-7-abc123",
      status: "prepared",
      fileContext: null,
    });
    expect("githubToken" in json).toBe(false);
    expect(await storage.get("github-token")).toBe("gho_secret");
  });

  it("indexes a session by caching the GitHub tree and recording file context", async () => {
    const storage = makeStorage();
    const fetchMock = installGithubFetchMock();

    await handleSessionObjectRequest(
      sessionRequest("/session", "POST", {
        repo: "tanvesh/rudu",
        number: 7,
        headSha: "abc123",
        githubToken: "gho_secret",
      }),
      storage as never,
      {},
    );

    const response = await handleSessionObjectRequest(
      sessionRequest("/hydrate", "POST"),
      storage as never,
      {},
    );

    const json = await response.json();
    expect(json.status).toBe("indexed");
    expect(json.fileContext).toMatchObject({
      provider: "github",
      fileCount: 3,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("lists direct child files and directories for root and nested paths", async () => {
    const storage = makeStorage();
    installGithubFetchMock();

    await handleSessionObjectRequest(
      sessionRequest("/session", "POST", {
        repo: "tanvesh/rudu",
        number: 7,
        headSha: "abc123",
        githubToken: "gho_secret",
      }),
      storage as never,
      {},
    );
    await handleSessionObjectRequest(
      sessionRequest("/hydrate", "POST"),
      storage as never,
      {},
    );

    const rootResponse = await handleSessionObjectRequest(
      sessionRequest("/files?path=.", "GET"),
      storage as never,
      {},
    );
    const nestedResponse = await handleSessionObjectRequest(
      sessionRequest("/files?path=src", "GET"),
      storage as never,
      {},
    );

    expect(await rootResponse.json()).toEqual({
      path: ".",
      entries: [
        { name: "src", path: "src", kind: "dir", size: null },
        { name: "README.md", path: "README.md", kind: "file", size: 18 },
      ],
    });
    expect(await nestedResponse.json()).toEqual({
      path: "src",
      entries: [
        { name: "utils", path: "src/utils", kind: "dir", size: null },
        { name: "index.ts", path: "src/index.ts", kind: "file", size: 31 },
      ],
    });
  });

  it("reads a text blob by sha and returns numbered line ranges", async () => {
    const storage = makeStorage();
    installGithubFetchMock();

    await handleSessionObjectRequest(
      sessionRequest("/session", "POST", {
        repo: "tanvesh/rudu",
        number: 7,
        headSha: "abc123",
        githubToken: "gho_secret",
      }),
      storage as never,
      {},
    );
    await handleSessionObjectRequest(
      sessionRequest("/hydrate", "POST"),
      storage as never,
      {},
    );

    const response = await handleSessionObjectRequest(
      sessionRequest("/file?path=src/index.ts&startLine=2&endLine=2", "GET"),
      storage as never,
      {},
    );

    expect(await response.json()).toEqual({
      path: "src/index.ts",
      startLine: 2,
      endLine: 2,
      totalLines: 3,
      body: "2: const two = 2;",
    });
  });

  it("returns clear errors for missing paths and directory reads", async () => {
    const storage = makeStorage();
    installGithubFetchMock();

    await handleSessionObjectRequest(
      sessionRequest("/session", "POST", {
        repo: "tanvesh/rudu",
        number: 7,
        headSha: "abc123",
        githubToken: "gho_secret",
      }),
      storage as never,
      {},
    );
    await handleSessionObjectRequest(
      sessionRequest("/hydrate", "POST"),
      storage as never,
      {},
    );

    const missing = await handleSessionObjectRequest(
      sessionRequest("/file?path=missing.ts", "GET"),
      storage as never,
      {},
    );
    const directory = await handleSessionObjectRequest(
      sessionRequest("/file?path=src", "GET"),
      storage as never,
      {},
    );

    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({
      error: "File not found in indexed tree: missing.ts",
    });
    expect(directory.status).toBe(400);
    expect(await directory.json()).toEqual({
      error: "Path is a directory, not a file: src",
    });
  });

  it("requires bearer auth at the public Worker boundary", async () => {
    const response = await handleWorkerRequest(
      new Request("https://remote-review.example/sessions", { method: "POST" }),
      makeRuntimeEnv({ apiToken: "secret" }),
    );

    expect(response.status).toBe(401);
  });

  it("reports unclaimed setup status without auth", async () => {
    const response = await handleWorkerRequest(
      workerRequest("/setup/status"),
      makeRuntimeEnv(),
    );

    expect(await response.json()).toEqual({
      ok: true,
      service: "rudu-remote-review",
      claimed: false,
      authMode: "unpaired",
    });
  });

  it("claims a Worker once and rejects later claims", async () => {
    const configStorage = makeStorage();
    const env = makeRuntimeEnv({ configStorage });

    const firstClaim = await handleWorkerRequest(
      workerRequest("/setup/claim", "POST", { apiToken: "paired-secret" }),
      env,
    );
    const secondClaim = await handleWorkerRequest(
      workerRequest("/setup/claim", "POST", { apiToken: "other-secret" }),
      env,
    );
    const status = await handleWorkerRequest(
      workerRequest("/setup/status"),
      env,
    );

    expect(firstClaim.status).toBe(200);
    expect(await firstClaim.json()).toEqual({
      ok: true,
      service: "rudu-remote-review",
      claimed: true,
      authMode: "paired",
    });
    expect(secondClaim.status).toBe(409);
    expect(await secondClaim.json()).toEqual({
      error: "Remote review Worker is already paired.",
    });
    expect(await status.json()).toEqual({
      ok: true,
      service: "rudu-remote-review",
      claimed: true,
      authMode: "paired",
    });
    expect(configStorage.values.get("worker-config")).toMatchObject({
      claimedAt: expect.any(Number),
      tokenHash: expect.any(String),
    });
    expect(JSON.stringify(configStorage.values.get("worker-config"))).not.toContain(
      "paired-secret",
    );
  });

  it("blocks health before pairing and protects it after pairing", async () => {
    const configStorage = makeStorage();
    const env = makeRuntimeEnv({ configStorage });
    const unpaired = await handleWorkerRequest(workerRequest("/health"), env);

    await handleWorkerRequest(
      workerRequest("/setup/claim", "POST", { apiToken: "paired-secret" }),
      env,
    );

    const unauthenticated = await handleWorkerRequest(
      workerRequest("/health"),
      env,
    );
    const wrongToken = await handleWorkerRequest(
      workerRequest("/health", "GET", undefined, "wrong-secret"),
      env,
    );
    const authenticated = await handleWorkerRequest(
      workerRequest("/health", "GET", undefined, "paired-secret"),
      env,
    );

    expect(unpaired.status).toBe(409);
    expect(await unpaired.json()).toEqual({
      error:
        "Remote review Worker is not paired. Pair this Worker in Rudu before using remote review.",
    });
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toEqual({
      error: "Unauthorized.",
    });
    expect(wrongToken.status).toBe(401);
    expect(await wrongToken.json()).toEqual({ error: "Unauthorized." });
    expect(authenticated.status).toBe(200);
    expect(await authenticated.json()).toEqual({
      ok: true,
      service: "rudu-remote-review",
    });
  });

  it("keeps session endpoints blocked until the Worker is paired", async () => {
    const configStorage = makeStorage();
    const env = makeRuntimeEnv({ configStorage });

    const unpaired = await handleWorkerRequest(workerRequest("/sessions", "POST"), env);
    await handleWorkerRequest(
      workerRequest("/setup/claim", "POST", { apiToken: "paired-secret" }),
      env,
    );
    const wrongToken = await handleWorkerRequest(
      workerRequest("/sessions", "POST", undefined, "wrong-secret"),
      env,
    );

    expect(unpaired.status).toBe(409);
    expect(wrongToken.status).toBe(401);
  });

  it("keeps env-token auth working without paired storage", async () => {
    const env = makeRuntimeEnv({ apiToken: "secret" });
    const status = await handleWorkerRequest(workerRequest("/setup/status"), env);
    const claim = await handleWorkerRequest(
      workerRequest("/setup/claim", "POST", { apiToken: "paired-secret" }),
      env,
    );
    const unauthenticated = await handleWorkerRequest(
      workerRequest("/health"),
      env,
    );
    const authenticated = await handleWorkerRequest(
      workerRequest("/health", "GET", undefined, "secret"),
      env,
    );

    expect(await status.json()).toEqual({
      ok: true,
      service: "rudu-remote-review",
      claimed: true,
      authMode: "env",
    });
    expect(claim.status).toBe(409);
    expect(await claim.json()).toEqual({
      error:
        "Remote review Worker is using RUDU_REMOTE_REVIEW_API_TOKEN and does not need pairing.",
    });
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toEqual({ error: "Unauthorized." });
    expect(authenticated.status).toBe(200);
    expect(await authenticated.json()).toEqual({
      ok: true,
      service: "rudu-remote-review",
    });
  });

  it("clears token and indexed file metadata when an indexed session expires", async () => {
    const storage = makeStorage();
    const now = Math.floor(Date.now() / 1000);
    await storage.put("session", {
      id: "tanvesh-rudu-pr-7-abc123",
      repo: "tanvesh/rudu",
      number: 7,
      headSha: "abc123",
      status: "indexed",
      fileContext: {
        provider: "github",
        indexedAt: now - 20,
        fileCount: 1,
        expiresAt: now - 10,
      },
      createdAt: now - 30,
      updatedAt: now - 20,
      lastError: null,
    });
    await storage.put("github-token", "gho_secret");
    await storage.put("dir:", [{ name: "README.md", path: "README.md", kind: "file", size: 10 }]);
    await storage.put("file:README.md", {
      path: "README.md",
      sha: "blob-readme",
      size: 10,
    });

    const response = await handleSessionObjectRequest(
      sessionRequest("/session", "GET"),
      storage as never,
      {},
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.status).toBe("stale");
    expect(json.fileContext.fileCount).toBe(1);
    expect(await storage.get("github-token")).toBeUndefined();
    expect(await storage.get("dir:")).toBeUndefined();
    expect(await storage.get("file:README.md")).toBeUndefined();
  });
});
