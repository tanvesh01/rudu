import { useEffect, useState } from "react";

const ONBOARDING_STORAGE_KEY = "rudu-onboarding-complete";

type UseOnboardingGateArgs = {
  isSavedReposPending: boolean;
  pathname: string;
  repoCount: number;
};

type CanStartOnboardingArgs = UseOnboardingGateArgs & {
  isOnboardingComplete: boolean;
};

type ShouldShowOnboardingArgs = {
  canStartOnboarding: boolean;
  isOnboardingActive: boolean;
  isOnboardingComplete: boolean;
};

function readOnboardingComplete() {
  try {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeOnboardingComplete() {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
  } catch {
    // If localStorage is unavailable, completion still applies for this render.
  }
}

function canStartOnboarding({
  isOnboardingComplete,
  isSavedReposPending,
  pathname,
  repoCount,
}: CanStartOnboardingArgs) {
  return (
    !isOnboardingComplete &&
    !isSavedReposPending &&
    pathname === "/" &&
    repoCount === 0
  );
}

function shouldShowOnboardingForState({
  canStartOnboarding: canStart,
  isOnboardingActive,
  isOnboardingComplete,
}: ShouldShowOnboardingArgs) {
  return !isOnboardingComplete && (isOnboardingActive || canStart);
}

function useOnboardingGate({
  isSavedReposPending,
  pathname,
  repoCount,
}: UseOnboardingGateArgs) {
  const [isOnboardingComplete, setIsOnboardingComplete] = useState(
    readOnboardingComplete,
  );
  const [isOnboardingActive, setIsOnboardingActive] = useState(false);
  const canStart = canStartOnboarding({
    isOnboardingComplete,
    isSavedReposPending,
    pathname,
    repoCount,
  });

  useEffect(() => {
    if (canStart) {
      setIsOnboardingActive(true);
    }
  }, [canStart]);

  function completeOnboarding() {
    writeOnboardingComplete();
    setIsOnboardingComplete(true);
    setIsOnboardingActive(false);
  }

  return {
    completeOnboarding,
    shouldShowOnboarding: shouldShowOnboardingForState({
      canStartOnboarding: canStart,
      isOnboardingActive,
      isOnboardingComplete,
    }),
  };
}

export { canStartOnboarding, shouldShowOnboardingForState, useOnboardingGate };
