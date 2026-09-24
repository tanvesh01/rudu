import { useEffect, useState } from "react";
import { SetupStep } from "./setup-step";
import { OnboardingWindowFrame } from "./window-frame";

type OnboardingFlowProps = {
  onComplete: () => void;
};

function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState<"splash" | "setup">("splash");

  useEffect(() => {
    if (step !== "splash") return;
    const timeout = window.setTimeout(() => setStep("setup"), 1000);
    return () => window.clearTimeout(timeout);
  }, [step]);

  return (
    <OnboardingWindowFrame>
      {step === "splash" ? (
        <SplashStep />
      ) : (
        <SetupStep onContinue={onComplete} />
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
