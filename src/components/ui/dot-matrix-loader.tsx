type DotMatrixLoaderVariant = "pulse" | "wave" | "scan" | "orbit" | "stack";

type DotMatrixLoaderProps = {
  variant?: DotMatrixLoaderVariant;
  label?: string;
  size?: "sm" | "md";
  showLabel?: boolean;
};

const DOTS = Array.from({ length: 9 }, (_, index) => index);

const VARIANT_DELAYS: Record<DotMatrixLoaderVariant, (index: number) => number> = {
  pulse: (index) => index * 80,
  wave: (index) => (index % 3) * 110 + Math.floor(index / 3) * 45,
  scan: (index) => index * 70,
  orbit: (index) => [0, 120, 240, 700, 840, 360, 600, 480, 960][index],
  stack: (index) => Math.floor(index / 3) * 130,
};

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function DotMatrixLoader({
  variant = "pulse",
  label = "Loading",
  size = "md",
  showLabel = true,
}: DotMatrixLoaderProps) {
  const delayFor = VARIANT_DELAYS[variant];

  return (
    <div
      aria-label={label}
      className="inline-flex flex-col items-center gap-2 text-ink-500"
      role="status"
    >
      <div
        className={cx(
          "dot-matrix-loader grid grid-cols-3",
          size === "sm" ? "gap-1" : "gap-1.5",
        )}
        data-variant={variant}
      >
        {DOTS.map((dot) => (
          <span
            aria-hidden="true"
            className={cx(
              "rounded-full bg-ink-800 dark:bg-ink-700",
              size === "sm" ? "size-1.5" : "size-2",
            )}
            key={dot}
            style={{ animationDelay: `${delayFor(dot)}ms` }}
          />
        ))}
      </div>
      {showLabel ? <span className="text-xs font-medium">{label}</span> : null}
    </div>
  );
}
export { DotMatrixLoader };
export type { DotMatrixLoaderProps, DotMatrixLoaderVariant };
