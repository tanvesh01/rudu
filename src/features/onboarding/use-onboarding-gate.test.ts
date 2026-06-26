import { describe, expect, it } from "bun:test";
import {
  canStartOnboarding,
  shouldShowOnboardingForState,
} from "./use-onboarding-gate";

describe("canStartOnboarding", () => {
  it("starts onboarding when repos are loaded, root path is active, and no repos are saved", () => {
    expect(
      canStartOnboarding({
        isOnboardingComplete: false,
        isSavedReposPending: false,
        pathname: "/",
        repoCount: 0,
      }),
    ).toBe(true);
  });

  it("does not start when onboarding is already complete", () => {
    expect(
      canStartOnboarding({
        isOnboardingComplete: true,
        isSavedReposPending: false,
        pathname: "/",
        repoCount: 0,
      }),
    ).toBe(false);
  });

  it("does not start when repoCount is greater than 0", () => {
    expect(
      canStartOnboarding({
        isOnboardingComplete: false,
        isSavedReposPending: false,
        pathname: "/",
        repoCount: 1,
      }),
    ).toBe(false);
  });

  it("does not start while saved repos are pending", () => {
    expect(
      canStartOnboarding({
        isOnboardingComplete: false,
        isSavedReposPending: true,
        pathname: "/",
        repoCount: 0,
      }),
    ).toBe(false);
  });

  it("does not start on non-root paths", () => {
    expect(
      canStartOnboarding({
        isOnboardingComplete: false,
        isSavedReposPending: false,
        pathname: "/repos",
        repoCount: 0,
      }),
    ).toBe(false);
  });

  it("does not start when query is pending regardless of repoCount", () => {
    expect(
      canStartOnboarding({
        isOnboardingComplete: false,
        isSavedReposPending: true,
        pathname: "/",
        repoCount: 5,
      }),
    ).toBe(false);
  });
});

describe("shouldShowOnboardingForState", () => {
  it("shows onboarding while it can start", () => {
    expect(
      shouldShowOnboardingForState({
        canStartOnboarding: true,
        isOnboardingActive: false,
        isOnboardingComplete: false,
      }),
    ).toBe(true);
  });

  it("keeps an active onboarding session visible after a repo is saved", () => {
    expect(
      shouldShowOnboardingForState({
        canStartOnboarding: false,
        isOnboardingActive: true,
        isOnboardingComplete: false,
      }),
    ).toBe(true);
  });

  it("hides inactive onboarding when it cannot start", () => {
    expect(
      shouldShowOnboardingForState({
        canStartOnboarding: false,
        isOnboardingActive: false,
        isOnboardingComplete: false,
      }),
    ).toBe(false);
  });

  it("hides onboarding after completion", () => {
    expect(
      shouldShowOnboardingForState({
        canStartOnboarding: true,
        isOnboardingActive: true,
        isOnboardingComplete: true,
      }),
    ).toBe(false);
  });
});
