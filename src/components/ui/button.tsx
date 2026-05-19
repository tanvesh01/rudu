import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30 disabled:cursor-default disabled:opacity-60",
  {
    variants: {
      variant: {
        default:
          "bg-brand-600 text-white hover:bg-brand-500",
        secondary:
          "border border-ink-200 bg-surface text-ink-900 hover:bg-canvasDark",
        ghost:
          "text-ink-600 hover:bg-canvasDark hover:text-ink-900",
        danger:
          "bg-danger-600 text-white hover:bg-red-700",
        inverse:
          "bg-ink-900 text-white hover:bg-ink-700 dark:bg-ink-200 dark:text-ink-900 dark:hover:bg-ink-300",
        link:
          "text-ink-600 underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-3 py-1.5",
        sm: "h-8 gap-1.5 rounded-md px-2 py-1 text-xs",
        lg: "h-10 px-4 py-2",
        icon: "size-8",
        "icon-sm": "size-7",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants>;

function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
export type { ButtonProps };
