import * as React from "react";
import {
  Truncate as TruncatePrimitive,
  Fruncate as FruncatePrimitive,
  MiddleTruncate as MiddleTruncatePrimitive,
} from "@pierre/truncate/react";

type TruncateTextProps = Omit<React.ComponentProps<typeof TruncatePrimitive>, "children"> & {
  children: string;
};

function TruncateText({
  children,
  ...props
}: TruncateTextProps) {
  return <TruncatePrimitive {...props}>{children}</TruncatePrimitive>;
}

type MiddleTruncateTextProps = Omit<
  React.ComponentProps<typeof MiddleTruncatePrimitive>,
  "children" | "contents"
> & {
  children: string;
};

function MiddleTruncateText({
  children,
  ...props
}: MiddleTruncateTextProps) {
  return <MiddleTruncatePrimitive {...props}>{children}</MiddleTruncatePrimitive>;
}

type FruncateTextProps = Omit<React.ComponentProps<typeof FruncatePrimitive>, "children"> & {
  children: string;
};

function FruncateText({
  children,
  ...props
}: FruncateTextProps) {
  return <FruncatePrimitive {...props}>{children}</FruncatePrimitive>;
}

export {
  TruncatePrimitive as Truncate,
  FruncatePrimitive as Fruncate,
  MiddleTruncatePrimitive as MiddleTruncate,
  TruncateText,
  MiddleTruncateText,
  FruncateText,
};
