import { useEffect, useState } from "react";
import type { RepoSummary } from "../../types/github";
import { RepositoryStep } from "./repository-step";
import { SetupStep } from "./setup-step";
import type { OnboardingCompleteHandler } from "./types";
import { OnboardingWindowFrame } from "./window-frame";

type OnboardingFlowProps = {
  savedRepos: RepoSummary[];
  onComplete: OnboardingCompleteHandler;
};

type OnboardingStep = "splash" | "setup" | "repositories";

function OnboardingFlow({ savedRepos, onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState<OnboardingStep>("splash");

  useEffect(() => {
    if (step !== "splash") return;
    const timeout = window.setTimeout(() => setStep("setup"), 1000);
    return () => window.clearTimeout(timeout);
  }, [step]);

  return (
    <OnboardingWindowFrame>
      {step === "splash" ? (
        <SplashStep />
      ) : step === "setup" ? (
        <SetupStep onContinue={() => setStep("repositories")} />
      ) : (
        <RepositoryStep
          initialSavedRepos={savedRepos}
          onComplete={onComplete}
        />
      )}
    </OnboardingWindowFrame>
  );
}

function SplashStep() {
  return (
    <div className="flex h-full items-center justify-center bg-canvas">
      <h1 className="text-3xl font-semibold tracking-normal text-ink-900">
        rudu
      </h1>
    </div>
  );
}

export { OnboardingFlow };
