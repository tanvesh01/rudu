import type { ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

type OnboardingWindowFrameProps = {
  children: ReactNode;
};

function OnboardingWindowFrame({ children }: OnboardingWindowFrameProps) {
  const appWindow = getCurrentWindow();

  return (
    <div className="relative h-full min-h-0 bg-canvas text-ink-900">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 z-20 h-8 cursor-grab active:cursor-grabbing"
        data-tauri-drag-region
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          if (event.detail === 2) {
            void appWindow.toggleMaximize();
            return;
          }
          void appWindow.startDragging();
        }}
      />
      <div className="h-full min-h-0">{children}</div>
    </div>
  );
}

export { OnboardingWindowFrame };
