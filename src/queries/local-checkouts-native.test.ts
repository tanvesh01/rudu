import { describe, expect, it } from "bun:test";
import {
  createLocalCheckoutNativeCommands,
  type InvokeFn,
} from "./local-checkouts-native";

function createRecordingInvoke() {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const invokeFn: InvokeFn = async <T>(
    command: string,
    args?: Record<string, unknown>,
  ) => {
    calls.push({ command, args });
    return undefined as T;
  };
  return { calls, invokeFn };
}

describe("local checkout native commands", () => {
  it("maps local checkout operations to stable Tauri command payloads", async () => {
    const { calls, invokeFn } = createRecordingInvoke();
    const commands = createLocalCheckoutNativeCommands(invokeFn);

    await commands.listLocalCheckouts();
    await commands.addLocalCheckout("/work/rudu");
    await commands.getLocalCheckoutStatus("checkout-1");
    await commands.getLocalCheckoutPatch("checkout-1", "revision-1");
    await commands.removeLocalCheckout("checkout-1");
    await commands.listReviewNotes("checkout-1");
    await commands.addUserReviewNote({
      checkoutId: "checkout-1",
      filePath: "src/main.ts",
      line: 12,
      side: "additions",
      startLine: 10,
      startSide: "additions",
      body: "Explain this change",
    });
    await commands.takeCliLaunchRequest();
    await commands.installCliLauncher();

    expect(calls).toEqual([
      { command: "list_local_checkouts", args: undefined },
      { command: "add_local_checkout", args: { path: "/work/rudu" } },
      { command: "get_local_checkout_status", args: { id: "checkout-1" } },
      {
        command: "get_local_checkout_patch",
        args: { id: "checkout-1", revision: "revision-1" },
      },
      { command: "remove_local_checkout", args: { id: "checkout-1" } },
      {
        command: "list_review_notes",
        args: { checkoutId: "checkout-1" },
      },
      {
        command: "add_user_review_note",
        args: {
          checkoutId: "checkout-1",
          filePath: "src/main.ts",
          line: 12,
          side: "additions",
          startLine: 10,
          startSide: "additions",
          body: "Explain this change",
        },
      },
      { command: "take_cli_launch_request", args: undefined },
      { command: "install_cli_launcher", args: undefined },
    ]);
  });
});
