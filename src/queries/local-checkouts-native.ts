import { invoke } from "@tauri-apps/api/core";
import type {
  LocalCheckout,
  LocalCheckoutPatch,
  LocalCheckoutStatus,
} from "../types/local-checkouts";

type InvokeFn = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

type CliLaunchRequest = {
  kind: "open_local_checkout";
  path: string;
};

type ReviewNote = {
  id: string;
  checkoutId: string;
  filePath: string;
  line: number;
  side: "additions" | "deletions";
  startLine: number | null;
  startSide: "additions" | "deletions" | null;
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
    getLocalCheckoutStatus(id: string) {
      return invokeCommand<LocalCheckoutStatus>("get_local_checkout_status", {
        id,
      });
    },
    getLocalCheckoutPatch(id: string, revision: string) {
      return invokeCommand<LocalCheckoutPatch>("get_local_checkout_patch", {
        id,
        revision,
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
    installCliLauncher() {
      return invokeCommand<string>("install_cli_launcher");
    },
  };
}

const localCheckoutNativeCommands = createLocalCheckoutNativeCommands(invoke);

export const {
  addLocalCheckout,
  addUserReviewNote,
  getLocalCheckoutPatch,
  getLocalCheckoutStatus,
  installCliLauncher,
  listLocalCheckouts,
  listReviewNotes,
  removeLocalCheckout,
  takeCliLaunchRequest,
} = localCheckoutNativeCommands;

export { createLocalCheckoutNativeCommands };
export type { CliLaunchRequest, InvokeFn, ReviewNote };
