import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { getRemoteReviewChatPrimaryActionLabel } from "./onboarding";

type RemoteReviewChatOnboardingDialogProps = {
  onContinue(): void;
  onOpenChange(open: boolean): void;
  open: boolean;
};

function RemoteReviewChatOnboardingDialog({
  onContinue,
  onOpenChange,
  open,
}: RemoteReviewChatOnboardingDialogProps) {
  return (
    <Dialog modal onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <div className="space-y-5 p-5">
          <DialogHeader>
            <DialogTitle>How AI chat works</DialogTitle>
            <DialogDescription>
              Ask Pi about the currently selected pull request, then keep
              exploring files and risks without leaving Rudu.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 text-sm leading-6 text-ink-700">
            <div className="rounded-xl border border-ink-200 bg-canvas p-3">
              <p className="font-medium text-ink-900">What you need</p>
              <ul className="mt-2 space-y-1.5 text-xs text-ink-600">
                <li>1. A local Pi coding agent installation on this machine</li>
                <li>2. The existing `pi-acp` runtime available to Rudu</li>
                <li>3. A selected PR that Rudu can prepare as a local workspace</li>
              </ul>
            </div>

            <div className="rounded-xl border border-ink-200 bg-canvas p-3">
              <p className="font-medium text-ink-900">What happens next</p>
              <p className="mt-2 text-xs text-ink-600">
                Rudu keeps a local workspace for the latest PR head. Pi reads
                the PR diff first, then uses read-only local file tools for
                extra context when needed.
              </p>
            </div>
          </div>

          <DialogFooter>
            <DialogClose className="rounded-lg bg-surface px-3 py-1 text-sm text-ink-700 transition hover:bg-canvas">
              Not now
            </DialogClose>
            <button
              className="rounded-lg border border-brand-600 bg-brand-600 px-3 py-1 text-sm text-white transition hover:bg-brand-500"
              onClick={onContinue}
              type="button"
            >
              {getRemoteReviewChatPrimaryActionLabel()}
            </button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { RemoteReviewChatOnboardingDialog };
export type { RemoteReviewChatOnboardingDialogProps };
