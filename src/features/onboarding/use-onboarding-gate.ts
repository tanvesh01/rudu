import { useEffect, useState } from "react";

const ONBOARDING_STORAGE_KEY = "rudu-onboarding-complete";

type UseOnboardingGateArgs = {
  isExistingSourcesPending: boolean;
  pathname: string;
  existingSourceCount: number;
  previewOnboarding?: boolean;
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
  isExistingSourcesPending,
  pathname,
  existingSourceCount,
  previewOnboarding = false,
}: CanStartOnboardingArgs) {
  return (
    !isOnboardingComplete &&
    !isExistingSourcesPending &&
    pathname === "/" &&
    (previewOnboarding || existingSourceCount === 0)
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
  isExistingSourcesPending,
  pathname,
  existingSourceCount,
  previewOnboarding = false,
}: UseOnboardingGateArgs) {
  const [isOnboardingComplete, setIsOnboardingComplete] = useState(() =>
    previewOnboarding ? false : readOnboardingComplete(),
  );
  const [isOnboardingActive, setIsOnboardingActive] = useState(false);
  const canStart = canStartOnboarding({
    isOnboardingComplete,
    isExistingSourcesPending,
    pathname,
    existingSourceCount,
    previewOnboarding,
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
