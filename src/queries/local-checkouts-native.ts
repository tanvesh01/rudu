import { invoke } from "@tauri-apps/api/core";
import type {
  LocalCheckout,
  LocalCheckoutPatch,
  LocalCheckoutStatus,
} from "../types/local-checkouts";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

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
  };
}

const localCheckoutNativeCommands = createLocalCheckoutNativeCommands(invoke);

export const {
  addLocalCheckout,
  getLocalCheckoutPatch,
  getLocalCheckoutStatus,
  listLocalCheckouts,
  removeLocalCheckout,
} = localCheckoutNativeCommands;

export { createLocalCheckoutNativeCommands };
export type { InvokeFn };
