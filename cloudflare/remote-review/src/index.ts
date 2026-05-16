import { handleConfigObjectRequest } from "./config-store";
import { handleSessionObjectRequest } from "./session-router";
import type { ConfigObjectEnv, RuntimeEnv, SessionObjectEnv } from "./types";
import { handleWorkerRequest } from "./worker-router";

export class RemoteReviewConfigObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly _env: ConfigObjectEnv,
  ) {}

  fetch(request: Request) {
    return handleConfigObjectRequest(request, this.state.storage);
  }
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

export { handleConfigObjectRequest } from "./config-store";
export { handleSessionObjectRequest } from "./session-router";
export { sessionIdFor } from "./session-id";
export { handleWorkerRequest } from "./worker-router";
export type {
  CachedDirectoryEntry,
  CachedFileEntry,
  ConfigObjectEnv,
  GitHubFileContext,
  RemoteReviewSession,
  SessionObjectEnv,
} from "./types";
