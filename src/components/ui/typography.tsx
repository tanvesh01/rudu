import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------
 * Text
 * ------------------------------------------------------------------ */

const textVariants = cva("", {
  variants: {
    size: {
      xs: "text-xs",
      sm: "text-sm",
      md: "text-base",
      lg: "text-lg",
    },
    weight: {
      normal: "font-normal",
      medium: "font-medium",
      semibold: "font-semibold",
      bold: "font-bold",
    },
    color: {
      default: "text-ink-900",
      muted: "text-ink-600",
      faint: "text-ink-500",
      inverse: "text-white",
    },
    align: {
      left: "text-left",
      center: "text-center",
      right: "text-right",
    },
    truncate: {
      true: "truncate",
      false: "",
    },
  },
  defaultVariants: {
    size: "sm",
    weight: "normal",
    color: "default",
    align: "left",
    truncate: false,
  },
});

type TextProps = React.ComponentProps<"span"> &
  VariantProps<typeof textVariants> & {
    as?: "span" | "p" | "label" | "div";
  };

function Text({
  as: Component = "span",
  className,
  size,
  weight,
  color,
  align,
  truncate,
  ...props
}: TextProps) {
  return (
    <Component
      data-slot="text"
      className={cn(
        textVariants({ size, weight, color, align, truncate, className })
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------
 * Heading
 * ------------------------------------------------------------------ */

const headingVariants = cva("font-semibold tracking-tight", {
  variants: {
    level: {
      "1": "text-2xl",
      "2": "text-xl",
      "3": "text-lg",
      "4": "text-base",
    },
    color: {
      default: "text-ink-900",
      muted: "text-ink-600",
      inverse: "text-white",
    },
  },
  defaultVariants: {
    level: "3",
    color: "default",
  },
});

type HeadingProps = React.ComponentProps<"h3"> &
  VariantProps<typeof headingVariants> & {
    as?: "h1" | "h2" | "h3" | "h4";
  };

function Heading({
  as: Component = "h3",
  className,
  level,
  color,
  ...props
}: HeadingProps) {
  return (
    <Component
      data-slot="heading"
      className={cn(headingVariants({ level, color, className }))}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------
 * Mono (for code/keyboard shortcuts)
 * ------------------------------------------------------------------ */

type MonoProps = React.ComponentProps<"code"> & {
  size?: "xs" | "sm" | "md";
};

function Mono({ className, size = "sm", ...props }: MonoProps) {
  return (
    <code
      data-slot="mono"
      className={cn(
        "rounded bg-canvas px-1 py-0.5 font-mono text-ink-800",
        size === "xs" && "text-xs",
        size === "sm" && "text-sm",
        size === "md" && "text-base",
        className
      )}
      {...props}
    />
  );
}

export { Text, Heading, Mono, textVariants, headingVariants };
export type { TextProps, HeadingProps, MonoProps };
