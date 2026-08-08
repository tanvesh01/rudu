import { ArrowRightIcon } from "@heroicons/react/20/solid";
import { useQuery } from "@tanstack/react-query";
import { ghCliStatusQueryOptions } from "../../queries/github";
import { getErrorMessage } from "../../lib/get-error-message";
import githubLogoUrl from "../../assets/provider-logos/github-invertocat-mark-white.svg";
import type { GhCliStatus } from "../../types/github";
import { CheckRow, type CheckStatus } from "./check-row";
import { AssetSetupCheckIcon } from "./setup-check-icon";
import { primaryOnboardingButtonClassName } from "./button-styles";

type SetupStepProps = {
  onContinue: () => void;
};

function SetupStep({ onContinue }: SetupStepProps) {
  const ghCliQuery = useQuery(ghCliStatusQueryOptions());
  const ghStatus = ghCliQuery.data ?? null;
  const isChecking = ghCliQuery.isFetching;
  const canContinue = !isChecking;

  function handleCheckAgain() {
    void ghCliQuery.refetch();
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas p-8 text-ink-900">
      <div className="mx-auto flex h-full w-full max-w-2xl flex-col">
        <div className="flex-1 pt-16">
          <h1 className="text-2xl font-semibold">Setup Rudu</h1>

          <section className="mt-8">
            <p className="text-xs font-semibold text-ink-700">Optional</p>
            <div className="mt-3 space-y-4">
              <CheckRow
                icon={<AssetSetupCheckIcon src={githubLogoUrl} />}
                label="GitHub CLI"
                status={statusFromGhCli(ghStatus, ghCliQuery)}
                detail={ghStatus?.message ?? getErrorMessage(ghCliQuery.error)}
              />
            </div>
          </section>
        </div>

        <div className="flex items-center justify-between pt-4">
          <button
            className="rounded-md bg-surface px-4 py-2 text-sm font-medium text-ink-700 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={isChecking}
            onClick={handleCheckAgain}
            type="button"
          >
            {isChecking ? "Checking..." : "Check again"}
          </button>
          <button
            className={primaryOnboardingButtonClassName}
            disabled={!canContinue}
            onClick={onContinue}
            type="button"
          >
            Continue
            <ArrowRightIcon aria-hidden="true" className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function statusFromGhCli(
  status: GhCliStatus | null,
  query: { isPending: boolean; isFetching: boolean },
): CheckStatus {
  if (query.isPending || query.isFetching) return "checking";
  return status?.status === "ready" ? "ready" : "missing";
}

export { SetupStep };
