import { ArrowRightIcon } from "@heroicons/react/20/solid";
import { useQuery } from "@tanstack/react-query";
import { ghCliStatusQueryOptions } from "../../queries/github";
import { reviewChatReadinessQueryOptions } from "../../queries/review-session";
import { getErrorMessage } from "../../lib/get-error-message";
import githubLogoUrl from "../../assets/provider-logos/github-invertocat-mark-white.svg";
import type {
  GhCliStatus,
  ReviewChatReadinessStatus,
} from "../../types/github";
import { CheckRow, type CheckStatus } from "./check-row";
import {
  AssetSetupCheckIcon,
  ProviderSetupCheckIcon,
} from "./setup-check-icon";
import { primaryOnboardingButtonClassName } from "./button-styles";

type SetupStepProps = {
  onContinue: () => void;
};

function SetupStep({ onContinue }: SetupStepProps) {
  const ghCliQuery = useQuery(ghCliStatusQueryOptions());
  const codexQuery = useQuery(reviewChatReadinessQueryOptions("codex"));
  const openCodeQuery = useQuery(reviewChatReadinessQueryOptions("open_code"));

  const ghStatus = ghCliQuery.data ?? null;
  const canContinue = ghStatus?.status === "ready";
  const isChecking =
    ghCliQuery.isFetching || codexQuery.isFetching || openCodeQuery.isFetching;

  function handleCheckAgain() {
    void ghCliQuery.refetch();
    void codexQuery.refetch();
    void openCodeQuery.refetch();
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas p-8 text-ink-900">
      <div className="mx-auto flex h-full w-full max-w-2xl flex-col">
        <div className="flex-1 pt-16">
          <h1 className="text-2xl font-semibold">Setup Rudu</h1>

          <section className="mt-8">
            <p className="text-xs font-semibold text-ink-700">Required</p>

            <CheckRow
              className="mt-3"
              icon={<AssetSetupCheckIcon src={githubLogoUrl} />}
              label="GitHub CLI"
              status={statusFromGhCli(ghStatus, ghCliQuery)}
              detail={ghStatus?.message ?? getErrorMessage(ghCliQuery.error)}
            />
          </section>

          <section className="mt-8">
            <p className="text-xs font-semibold text-ink-700">Optional</p>
            <div className="mt-3 space-y-4">
              <CheckRow
                icon={
                  <ProviderSetupCheckIcon
                    fallback="C"
                    providerId="openai"
                  />
                }
                label="Codex"
                status={statusFromReadiness(codexQuery.data, codexQuery)}
                detail={
                  codexQuery.data?.message ?? getErrorMessage(codexQuery.error)
                }
              />
              <CheckRow
                icon={
                  <ProviderSetupCheckIcon
                    fallback="O"
                    providerId="opencode"
                  />
                }
                label="OpenCode"
                status={statusFromReadiness(openCodeQuery.data, openCodeQuery)}
                detail={
                  openCodeQuery.data?.message ??
                  getErrorMessage(openCodeQuery.error)
                }
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

function statusFromReadiness(
  status: ReviewChatReadinessStatus | undefined,
  query: { isPending: boolean; isFetching: boolean },
): CheckStatus {
  if (query.isPending || query.isFetching) return "checking";
  return status?.status === "ready" ? "ready" : "missing";
}

export { SetupStep };
