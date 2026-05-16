import { CONFIG_OBJECT_NAME, SERVICE_NAME } from "./constants";
import { errorResponse, jsonResponse, readBearerToken, readJson } from "./http";
import { parseSessionIdPath, validateSessionId } from "./paths";
import { sessionIdFor } from "./session-id";
import type { PrepareSessionInput, RuntimeEnv } from "./types";
import { validatePrepareSessionInput } from "./validation";

function configStub(env: RuntimeEnv) {
  const objectId = env.REMOTE_REVIEW_CONFIG.idFromName(CONFIG_OBJECT_NAME);
  return env.REMOTE_REVIEW_CONFIG.get(objectId);
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

function forwardToConfigObject(
  env: RuntimeEnv,
  pathname: string,
  request: Request,
  body?: BodyInit,
) {
  return configStub(env).fetch(
    new Request(`https://config.local${pathname}`, {
      method: request.method,
      body,
      headers: body ? { "content-type": "application/json" } : undefined,
    }),
  );
}

async function requireWorkerAuth(request: Request, env: RuntimeEnv) {
  if (env.RUDU_REMOTE_REVIEW_API_TOKEN) {
    const expected = `Bearer ${env.RUDU_REMOTE_REVIEW_API_TOKEN}`;
    return request.headers.get("authorization") === expected
      ? null
      : errorResponse("Unauthorized.", 401);
  }

  const apiToken = readBearerToken(request);
  return forwardToConfigObject(
    env,
    "/verify",
    new Request("https://config.local/verify", { method: "POST" }),
    JSON.stringify(apiToken ? { apiToken } : {}),
  ).then((response) => (response.ok ? null : response));
}

export async function handleWorkerRequest(request: Request, env: RuntimeEnv) {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/setup/status") {
    if (env.RUDU_REMOTE_REVIEW_API_TOKEN) {
      return jsonResponse({
        ok: true,
        service: SERVICE_NAME,
        claimed: true,
        authMode: "env",
      });
    }

    return forwardToConfigObject(env, "/status", request);
  }

  if (request.method === "POST" && url.pathname === "/setup/claim") {
    if (env.RUDU_REMOTE_REVIEW_API_TOKEN) {
      return errorResponse(
        "Remote review Worker is using RUDU_REMOTE_REVIEW_API_TOKEN and does not need pairing.",
        409,
      );
    }

    return forwardToConfigObject(env, "/claim", request, await request.text());
  }

  const authError = await requireWorkerAuth(request, env);
  if (authError) return authError;

  if (request.method === "GET" && url.pathname === "/health") {
    return jsonResponse({ ok: true, service: SERVICE_NAME });
  }

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
