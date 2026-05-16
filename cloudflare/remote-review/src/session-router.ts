import {
  hydrateSession,
  listDirectoryEntries,
  readIndexedFile,
} from "./github-files";
import { errorResponse, jsonResponse, readJson } from "./http";
import {
  createOrLoadSession,
  loadSessionForGet,
  updateSessionStatus,
} from "./session-store";
import type { PrepareSessionInput, SessionObjectEnv, StatusUpdateInput } from "./types";
import { validatePrepareSessionInput, validateStatusUpdate } from "./validation";

export async function handleSessionObjectRequest(
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
