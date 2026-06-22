import { useEffect, useState } from "react";

const ONBOARDING_STORAGE_KEY = "rudu-onboarding-complete";
// When removing this flag (setting to false), also clear the
// `rudu-onboarding-complete` localStorage key so real users get the flow.
const FORCE_ONBOARDING_FLOW = true;

function readOnboardingComplete() {
  if (FORCE_ONBOARDING_FLOW) return false;

  try {
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeOnboardingComplete() {
  try {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
  } catch {
    // If localStorage is unavailable, completion still applies for this render.
  }
}

type UseOnboardingGateArgs = {
  isSavedReposPending: boolean;
  pathname: string;
  repoCount: number;
};

function useOnboardingGate({
  isSavedReposPending,
  pathname,
  repoCount,
}: UseOnboardingGateArgs) {
  const [isOnboardingComplete, setIsOnboardingComplete] = useState(
    readOnboardingComplete,
  );
  const [isOnboardingActive, setIsOnboardingActive] = useState(false);

  useEffect(() => {
    if (
      !isOnboardingComplete &&
      !isSavedReposPending &&
      (FORCE_ONBOARDING_FLOW || (pathname === "/" && repoCount === 0))
    ) {
      setIsOnboardingActive(true);
    }
  }, [isOnboardingComplete, isSavedReposPending, pathname, repoCount]);

  function completeOnboarding() {
    writeOnboardingComplete();
    setIsOnboardingComplete(true);
    setIsOnboardingActive(false);
  }

  return {
    completeOnboarding,
    shouldShowOnboarding: isOnboardingActive && !isOnboardingComplete,
  };
}

export { FORCE_ONBOARDING_FLOW, useOnboardingGate };
