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
    }
  | {
      kind: "open_pull_request";
      repo: string;
      number: number;
    };

type SessionTarget =
  | {
      kind: "local_checkout";
      checkoutId: string;
      source: LocalDiffSource | null;
    }
  | {
      kind: "pull_request";
      repo: string;
      number: number;
    };

type SessionNavigation = {
  requestId: number;
  target: SessionTarget;
  file: string;
  line: number;
  side: "additions" | "deletions";
};

type ReviewNoteOwner =
  | { kind: "checkout"; checkoutId: string }
  | {
      kind: "pull_request_revision";
      repo: string;
      number: number;
      headSha: string;
    };

type PublishedReview = {
  repo: string;
  number: number;
  headSha: string;
  reviewId: string;
  reviewUrl: string;
  publishedCount: number;
  cleanupError: string | null;
};

type AddUserAnnotationInput = {
  owner: ReviewNoteOwner;
  scope: string;
  filePath: string;
  line: number;
  side: "additions" | "deletions";
  startLine: number | null;
  startSide: "additions" | "deletions" | null;
  body: string;
};

type ReviewNote = {
  id: string;
  targetKey: string;
  scope: string;
  filePath: string;
  line: number;
  side: "additions" | "deletions";
  startLine: number | null;
  startSide: "additions" | "deletions" | null;
  replyToId: string | null;
  body: string;
  kind: "note" | "comment_draft";
  author: "user" | "agent";
  authorName: string | null;
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
    listReviewNotes(owner: ReviewNoteOwner, scope: string) {
      return invokeCommand<ReviewNote[]>("list_review_notes", { owner, scope });
    },
    addUserReviewNote(input: AddUserAnnotationInput) {
      return invokeCommand<ReviewNote>("add_user_review_note", input);
    },
    addUserReviewCommentDraft(input: AddUserAnnotationInput) {
      return invokeCommand<ReviewNote>(
        "add_user_review_comment_draft",
        input,
      );
    },
    promoteReviewNote(
      owner: ReviewNoteOwner,
      scope: string,
      noteId: string,
    ) {
      return invokeCommand<ReviewNote>("promote_review_note", {
        owner,
        scope,
        noteId,
      });
    },
    publishReviewNotes(owner: ReviewNoteOwner, scope: string) {
      return invokeCommand<PublishedReview>("publish_review_notes", {
        owner,
        scope,
      });
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
    setActiveSessionTarget(target: SessionTarget | null) {
      return invokeCommand<void>("set_active_session_target", { target });
    },
    installCliLauncher() {
      return invokeCommand<string>("install_cli_launcher");
    },
  };
}

const localCheckoutNativeCommands = createLocalCheckoutNativeCommands(invoke);

export const {
  addLocalCheckout,
  addUserReviewCommentDraft,
  addUserReviewNote,
  completeSessionNavigation,
  getLocalCheckoutPatch,
  getLocalCheckoutStatus,
  installCliLauncher,
  listLocalCheckouts,
  listReviewNotes,
  promoteReviewNote,
  publishReviewNotes,
  removeLocalCheckout,
  setActiveSessionTarget,
  takeCliLaunchRequest,
  takeSessionNavigation,
} = localCheckoutNativeCommands;

export { createLocalCheckoutNativeCommands };
export type {
  AddUserAnnotationInput,
  CliLaunchRequest,
  InvokeFn,
  PublishedReview,
  ReviewNote,
  ReviewNoteOwner,
  SessionNavigation,
  SessionTarget,
};
