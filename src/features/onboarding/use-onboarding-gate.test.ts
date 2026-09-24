import { describe, expect, it } from "bun:test";
import {
  canStartOnboarding,
  shouldShowOnboardingForState,
} from "./use-onboarding-gate";

const firstRun = {
  isOnboardingComplete: false,
  isExistingSourcesPending: false,
  pathname: "/",
  existingSourceCount: 0,
};

describe("canStartOnboarding", () => {
  it("starts on the first visit to the PR inbox with no existing sources", () => {
    expect(canStartOnboarding(firstRun)).toBe(true);
  });

  it("does not interrupt returning users or active workspaces", () => {
    expect(canStartOnboarding({ ...firstRun, isOnboardingComplete: true })).toBe(false);
    expect(canStartOnboarding({ ...firstRun, existingSourceCount: 1 })).toBe(false);
  });

  it("allows a dev preview with existing sources, but still exits on completion", () => {
    expect(canStartOnboarding({ ...firstRun, existingSourceCount: 1, previewOnboarding: true })).toBe(true);
    expect(canStartOnboarding({ ...firstRun, isOnboardingComplete: true, previewOnboarding: true })).toBe(false);
  });

  it("waits for sources and only starts at the root", () => {
    expect(canStartOnboarding({ ...firstRun, isExistingSourcesPending: true })).toBe(false);
    expect(canStartOnboarding({ ...firstRun, pathname: "/local" })).toBe(false);
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

  it("keeps an active onboarding session visible after sources change", () => {
    expect(
      shouldShowOnboardingForState({
        canStartOnboarding: false,
        isOnboardingActive: true,
        isOnboardingComplete: false,
      }),
    ).toBe(true);
  });

  it("hides inactive or completed onboarding", () => {
    expect(
      shouldShowOnboardingForState({
        canStartOnboarding: false,
        isOnboardingActive: false,
        isOnboardingComplete: false,
      }),
    ).toBe(false);
    expect(
      shouldShowOnboardingForState({
        canStartOnboarding: true,
        isOnboardingActive: true,
        isOnboardingComplete: true,
      }),
    ).toBe(false);
  });
});
