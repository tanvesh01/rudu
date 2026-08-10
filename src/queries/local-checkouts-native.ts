import { invoke } from "@tauri-apps/api/core";
import type {
  LocalCheckout,
  LocalCheckoutPatch,
  LocalCheckoutStatus,
  LocalDiffSource,
} from "../types/local-checkouts";

type InvokeFn = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

type CliLaunchRequest =
  | {
      kind: "open_local_checkout";
      path: string;
    }
  | {
      kind: "open_diff";
      path: string;
      source: LocalDiffSource;
    };

type SessionNavigation = {
  requestId: number;
  checkoutId: string;
  file: string;
  line: number;
  side: "additions" | "deletions";
};

type ReviewNote = {
  id: string;
  checkoutId: string;
  filePath: string;
  line: number;
  side: "additions" | "deletions";
  startLine: number | null;
  startSide: "additions" | "deletions" | null;
  replyToId: string | null;
  body: string;
  author: "user" | "agent";
  createdAt: number;
};

function createLocalCheckoutNativeCommands(invokeCommand: InvokeFn) {
  return {
    listLocalCheckouts() {
      return invokeCommand<LocalCheckout[]>("list_local_checkouts");
    },
    addLocalCheckout(path: string) {
      return invokeCommand<LocalCheckout>("add_local_checkout", { path });
    },
    getLocalCheckoutStatus(id: string, source?: LocalDiffSource) {
      return invokeCommand<LocalCheckoutStatus>("get_local_checkout_status", {
        id,
        ...(source ? { source } : {}),
      });
    },
    getLocalCheckoutPatch(
      id: string,
      revision: string,
      source?: LocalDiffSource,
    ) {
      return invokeCommand<LocalCheckoutPatch>("get_local_checkout_patch", {
        id,
        revision,
        ...(source ? { source } : {}),
      });
    },
    removeLocalCheckout(id: string) {
      return invokeCommand<void>("remove_local_checkout", { id });
    },
    listReviewNotes(checkoutId: string) {
      return invokeCommand<ReviewNote[]>("list_review_notes", { checkoutId });
    },
    addUserReviewNote(input: {
      checkoutId: string;
      filePath: string;
      line: number;
      side: "additions" | "deletions";
      startLine: number | null;
      startSide: "additions" | "deletions" | null;
      body: string;
    }) {
      return invokeCommand<ReviewNote>("add_user_review_note", input);
    },
    takeCliLaunchRequest() {
      return invokeCommand<CliLaunchRequest | null>("take_cli_launch_request");
    },
    takeSessionNavigation() {
      return invokeCommand<SessionNavigation | null>("take_session_navigation");
    },
    completeSessionNavigation(requestId: number) {
      return invokeCommand<void>("complete_session_navigation", { requestId });
    },
    installCliLauncher() {
      return invokeCommand<string>("install_cli_launcher");
    },
  };
}

const localCheckoutNativeCommands = createLocalCheckoutNativeCommands(invoke);

export const {
  addLocalCheckout,
  addUserReviewNote,
  completeSessionNavigation,
  getLocalCheckoutPatch,
  getLocalCheckoutStatus,
  installCliLauncher,
  listLocalCheckouts,
  listReviewNotes,
  removeLocalCheckout,
  takeCliLaunchRequest,
  takeSessionNavigation,
} = localCheckoutNativeCommands;

export { createLocalCheckoutNativeCommands };
export type { CliLaunchRequest, InvokeFn, ReviewNote, SessionNavigation };
