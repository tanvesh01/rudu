import {
  SERVICE_NAME,
  WORKER_CONFIG_STORAGE_KEY,
} from "./constants";
import { errorResponse, jsonResponse, readJson } from "./http";
import type {
  ClaimWorkerInput,
  VerifyWorkerInput,
  WorkerPairingConfig,
  WorkerSetupStatus,
} from "./types";

function nowUnixTimestamp() {
  return Math.floor(Date.now() / 1000);
}

function statusForConfig(
  config: WorkerPairingConfig | undefined,
): WorkerSetupStatus {
  return {
    ok: true,
    service: SERVICE_NAME,
    claimed: Boolean(config),
    authMode: config ? "paired" : "unpaired",
  };
}

function readPairingToken(input: ClaimWorkerInput | VerifyWorkerInput) {
  if (typeof input.apiToken !== "string" || input.apiToken.trim() === "") {
    throw errorResponse("Remote review Worker API token is required.", 400);
  }

  return input.apiToken.trim();
}

function readVerificationToken(input: VerifyWorkerInput) {
  if (typeof input.apiToken !== "string" || input.apiToken.trim() === "") {
    return null;
  }

  return input.apiToken.trim();
}

async function hashToken(token: string) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function timingSafeEqual(left: string, right: string) {
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return mismatch === 0;
}

async function loadPairingConfig(storage: DurableObjectStorage) {
  return storage.get<WorkerPairingConfig>(WORKER_CONFIG_STORAGE_KEY);
}

export async function handleConfigObjectRequest(
  request: Request,
  storage: DurableObjectStorage,
) {
  const url = new URL(request.url);

  try {
    if (request.method === "GET" && url.pathname === "/status") {
      return jsonResponse(statusForConfig(await loadPairingConfig(storage)));
    }

    if (request.method === "POST" && url.pathname === "/claim") {
      const apiToken = readPairingToken(
        await readJson<ClaimWorkerInput>(request),
      );
      const tokenHash = await hashToken(apiToken);
      const result = await storage.transaction(async (txn) => {
        const existing = await txn.get<WorkerPairingConfig>(
          WORKER_CONFIG_STORAGE_KEY,
        );
        if (existing) {
          return { alreadyClaimed: true as const };
        }

        const config: WorkerPairingConfig = {
          tokenHash,
          claimedAt: nowUnixTimestamp(),
        };
        await txn.put(WORKER_CONFIG_STORAGE_KEY, config);
        return { alreadyClaimed: false as const, config };
      });

      if (result.alreadyClaimed) {
        return errorResponse("Remote review Worker is already paired.", 409);
      }

      const { config } = result;
      return jsonResponse(statusForConfig(config));
    }

    if (request.method === "POST" && url.pathname === "/verify") {
      const config = await loadPairingConfig(storage);
      if (!config) {
        return errorResponse(
          "Remote review Worker is not paired. Pair this Worker in Rudu before using remote review.",
          409,
        );
      }

      const apiToken = readVerificationToken(
        await readJson<VerifyWorkerInput>(request),
      );
      if (!apiToken) {
        return errorResponse("Unauthorized.", 401);
      }

      const tokenHash = await hashToken(apiToken);
      if (!timingSafeEqual(tokenHash, config.tokenHash)) {
        return errorResponse("Unauthorized.", 401);
      }

      return jsonResponse({ ok: true });
    }

    return errorResponse("Not found.", 404);
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(message, 400);
  }
}
