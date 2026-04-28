import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";

type TooltipProps = {
  children: ReactElement;
  content: ReactNode;
  delay?: number;
  sideOffset?: number;
};

function Tooltip({
  children,
  content,
  delay = 300,
  sideOffset = 8,
}: TooltipProps) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger delay={delay} render={children} />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner sideOffset={sideOffset}>
          <TooltipPrimitive.Popup className="z-50 rounded-md border border-ink-200 bg-ink-900 px-2 py-1 text-xs font-medium text-white shadow-lg dark:border-ink-700 dark:bg-ink-100 dark:text-ink-900">
            <TooltipPrimitive.Arrow className="flex text-ink-900 dark:text-ink-100">
              <svg
                aria-hidden="true"
                className="block"
                fill="currentColor"
                height="6"
                viewBox="0 0 10 6"
                width="10"
              >
                <path d="M5 0 10 6H0Z" />
              </svg>
            </TooltipPrimitive.Arrow>
            {content}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

const TooltipProvider = TooltipPrimitive.Provider;

export { Tooltip, TooltipProvider };
export type { TooltipProps };
