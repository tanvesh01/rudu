import type { SelectedPullRequestRef } from "../../types/github";

type OnboardingCompleteHandler = (
  firstTrackedPullRequest: SelectedPullRequestRef | null,
) => void;

export type { OnboardingCompleteHandler };
