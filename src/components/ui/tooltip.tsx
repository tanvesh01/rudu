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
          <TooltipPrimitive.Popup className="z-50 rounded-md bg-ink-900 px-2 py-1 text-xs font-semibold text-white shadow-lg dark:border-ink-700 dark:bg-ink-100 dark:text-ink-800">
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
