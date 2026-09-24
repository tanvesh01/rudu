import { useEffect, useState, type CSSProperties } from "react";
import "./LissajousLoader.css";

const SIZE = 440;
const POINTS = 600;
const SYMBOLS = 24;
const CYCLES = 4;
const DEFAULT_COLOR = "#FFFFFF";
export const LOADER_DURATION_SECONDS = 12;

// These unwrapped angles display as 270°, 315°, 120°, 210°, then 270°.
const PHASE_STOPS = [270, 315, 480, 570, 630] as const;
const FREQUENCIES = [
  { a: 1, b: 1 },
  { a: 3, b: 2 },
  { a: 5, b: 4 },
  { a: 1, b: 1 },
] as const;

type Point = { x: number; y: number };
export type LissajousLoaderProps = {
  /** Progress through the full 12-second loop, from 0 to 1. Omit to animate automatically. */
  progress?: number;
  /** Display size of each curve in CSS pixels. */
  size?: number;
  /** Color of the 1s, 0s, squares, and triangles. */
  symbolColor?: string;
  className?: string;
  style?: CSSProperties;
};

const cubic = (t: number, first: number, second: number) =>
  3 * (1 - t) ** 2 * t * first + 3 * (1 - t) * t ** 2 * second + t ** 3;

// Equivalent to cubic-bezier(0.65, 0, 0.35, 1), without a Remotion dependency.
const easeInOut = (progress: number) => {
  let t = progress;
  for (let index = 0; index < 7; index++) {
    const x = cubic(t, 0.65, 0.35);
    const slope =
      3 * (1 - t) ** 2 * 0.65 +
      6 * (1 - t) * t * (0.35 - 0.65) +
      3 * t ** 2 * (1 - 0.35);
    t = Math.max(0, Math.min(1, t - (x - progress) / slope));
  }
  return cubic(t, 0, 1);
};

const pointAt = (t: number, a: number, b: number, phase: number): Point => ({
  x: Math.sin(a * t + phase),
  y: -Math.sin(b * t),
});

const curvePoints = (progress: number, phase: number): Point[] => {
  const position = progress * (FREQUENCIES.length - 1);
  const segment = Math.min(FREQUENCIES.length - 2, Math.floor(position));
  const blend = easeInOut(position - segment);
  const from = FREQUENCIES[segment];
  const to = FREQUENCIES[segment + 1];
  const radius = SIZE * 0.39;
  const center = SIZE / 2;
  const points: Point[] = [];

  for (let index = 0; index < POINTS; index++) {
    const t = (index / POINTS) * Math.PI * 2;
    const start = pointAt(t, from.a, from.b, phase);
    const end = pointAt(t, to.a, to.b, phase);
    points.push({
      x: center + radius * (start.x + (end.x - start.x) * blend),
      y: center + radius * (start.y + (end.y - start.y) * blend),
    });
  }
  return points;
};

const symbolPositions = (points: Point[]): Point[] => {
  const lengths = [0];
  for (let index = 0; index < points.length; index++) {
    const from = points[index];
    const to = points[(index + 1) % points.length];
    lengths.push(lengths[index] + Math.hypot(to.x - from.x, to.y - from.y));
  }

  const totalLength = lengths[lengths.length - 1];
  const positions: Point[] = [];
  let segment = 0;
  for (let index = 0; index < SYMBOLS; index++) {
    const target = ((index + 0.5) / SYMBOLS) * totalLength;
    while (lengths[segment + 1] < target) segment++;
    const from = points[segment];
    const to = points[(segment + 1) % points.length];
    const blend =
      (target - lengths[segment]) / (lengths[segment + 1] - lengths[segment]);
    positions.push({
      x: from.x + (to.x - from.x) * blend,
      y: from.y + (to.y - from.y) * blend,
    });
  }
  return positions;
};

const symbolOpacity = (index: number) => 0.4 + (((index * 7) % 11) / 10) * 0.6;

export const LissajousLoader = ({
  progress,
  size = SIZE,
  symbolColor = DEFAULT_COLOR,
  className,
  style,
}: LissajousLoaderProps) => {
  const [liveProgress, setLiveProgress] = useState(0);

  useEffect(() => {
    if (
      progress !== undefined ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const start = performance.now();
    let animationFrame = 0;
    const animate = (now: number) => {
      setLiveProgress(
        ((now - start) % (LOADER_DURATION_SECONDS * 1000)) /
          (LOADER_DURATION_SECONDS * 1000),
      );
      animationFrame = requestAnimationFrame(animate);
    };
    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [progress]);

  const loopProgress = (((progress ?? liveProgress) % 1) + 1) % 1;
  const cyclePosition = loopProgress * CYCLES;
  const cycle = Math.min(CYCLES - 1, Math.floor(cyclePosition));
  const cycleProgress = cyclePosition - cycle;
  const phaseDegrees =
    PHASE_STOPS[cycle] +
    (PHASE_STOPS[cycle + 1] - PHASE_STOPS[cycle]) * easeInOut(cycleProgress);
  const points = curvePoints(cycleProgress, (phaseDegrees * Math.PI) / 180);

  return (
    <div
      className={className}
      style={{
        alignItems: "center",
        display: "flex",
        height: "100%",
        justifyContent: "center",
        minHeight: size,
        width: "100%",
        ...style,
      }}
    >
      <svg
        aria-label="Symbol curve"
        role="img"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={size}
        height={size}
        style={{ height: "auto", maxWidth: "100%" }}
      >
        {symbolPositions(points).map((point, index) => {
          const opacity = symbolOpacity(index);
          if (index % 8 === 2) {
            return (
              <rect
                key={index}
                x={point.x - 10}
                y={point.y - 10}
                width={20}
                height={20}
                fill="none"
                opacity={opacity}
                stroke={symbolColor}
                strokeWidth={2.5}
              />
            );
          }
          if (index % 8 === 5) {
            return (
              <polygon
                key={index}
                points={`${point.x},${point.y - 11} ${point.x + 11},${point.y + 9} ${point.x - 11},${point.y + 9}`}
                fill="none"
                opacity={opacity}
                stroke={symbolColor}
                strokeLinejoin="round"
                strokeWidth={2.5}
              />
            );
          }
          return (
            <text
              key={index}
              x={point.x}
              y={point.y}
              dominantBaseline="central"
              fill={symbolColor}
              fontFamily='"Departure Mono", monospace'
              fontSize={40}
              opacity={opacity}
              textAnchor="middle"
            >
              {index % 2 === 0 ? "1" : "0"}
            </text>
          );
        })}
      </svg>
    </div>
  );
};
