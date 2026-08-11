import type { ReactNode } from "react";

type OnboardingWindowFrameProps = {
  children: ReactNode;
};

function OnboardingWindowFrame({ children }: OnboardingWindowFrameProps) {
  return (
    <div className="relative h-full min-h-0 bg-canvas text-ink-900">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 z-20 h-8"
        data-tauri-drag-region
      />
      <div className="h-full min-h-0">{children}</div>
    </div>
  );
}

export { OnboardingWindowFrame };
