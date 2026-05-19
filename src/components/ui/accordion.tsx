import * as React from "react";
import { Accordion } from "@base-ui/react/accordion";

import { cn } from "@/lib/utils";

function AccordionRoot({
  className,
  ...props
}: React.ComponentProps<typeof Accordion.Root>) {
  return (
    <Accordion.Root
      className={cn("flex flex-col gap-2.5", className)}
      {...props}
    />
  );
}

function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof Accordion.Item>) {
  return <Accordion.Item className={cn(className)} {...props} />;
}

function AccordionHeader({
  className,
  ...props
}: React.ComponentProps<typeof Accordion.Header>) {
  return (
    <Accordion.Header
      className={cn("m-0", className)}
      {...props}
    />
  );
}

function AccordionTrigger({
  className,
  ...props
}: React.ComponentProps<typeof Accordion.Trigger>) {
  return (
    <Accordion.Trigger
      className={cn(
        "flex w-full items-center gap-2.5 border text-ink-500 bg-canvas px-3 py-2.5 text-left text-sm [&[data-panel-open]]:border-zinc-400",
        className,
      )}
      {...props}
    />
  );
}

function AccordionPanel({
  className,
  ...props
}: React.ComponentProps<typeof Accordion.Panel>) {
  return (
    <Accordion.Panel
      className={cn(
        "grid transition-[grid-template-rows] duration-200 data-[starting-style]:grid-rows-[0fr] data-[ending-style]:grid-rows-[0fr] grid-rows-[1fr]",
        className,
      )}
      {...props}
    />
  );
}

export {
  AccordionRoot as Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionTrigger,
  AccordionPanel,
};
