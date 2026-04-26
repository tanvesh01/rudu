import type { GhCliStatusKind } from "../types/github";

export const GH_CLI_CHECKING_TOAST_ID = "gh-cli-checking";
export const GH_CLI_WARNING_TOAST_ID = "gh-cli-warning";
export const GH_CLI_TOAST_LOCK_VISIBLE = false;

export function getGhCliWarningCopy(
  status: GhCliStatusKind,
  message: string | null,
): { title: string; description: string } {
  if (status === "ready") {
    return {
      title: "GitHub CLI ready",
      description: "Toast preview is locked visible for styling.",
    };
  }

  if (status === "missing_cli") {
    return {
      title: "GitHub CLI not found",
      description:
        "This app will not work until gh is installed and authenticated. Try: brew install gh, then gh auth login.",
    };
  }

  if (status === "not_authenticated") {
    return {
      title: "GitHub CLI not authenticated",
      description:
        "This app will not work until gh is authenticated with GitHub. Run: gh auth login.",
    };
  }

  return {
    title: "Unable to verify GitHub CLI",
    description:
      message ??
      "This app may not work until gh is installed and authenticated. Verify your local gh setup and retry.",
  };
}
