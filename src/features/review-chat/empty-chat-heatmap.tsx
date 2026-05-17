/** @paper-design/shaders-react@0.0.76 */
import { Heatmap } from "@paper-design/shaders-react";
import type { CSSProperties } from "react";

type ChatHeatmapProps = {
  className?: string;
  size?: number;
};

/**
 * from Paper
 * https://app.paper.design/file/01K4S5FQARQ2720154S3BEFQ4B/01K4S5FQAR7AA1ARW7CF2N8A8T/6-0
 * on May 17, 2026
 */
function ChatHeatmap({ className = "", size = 50 }: ChatHeatmapProps) {
  const sizeStyle = `${size}px`;
  const style = {
    backgroundColor: "#FFFFFF",
    borderRadius: "9999px",
    height: sizeStyle,
    width: sizeStyle,
  } satisfies CSSProperties;

  return (
    <div aria-hidden="true" className={`flex justify-start ${className}`}>
      <Heatmap
        speed={1.4}
        contour={0.859}
        angle={0}
        noise={1}
        innerGlow={0.73}
        outerGlow={0.5}
        scale={2}
        colors={["#0D6722", "#FFFFFF"]}
        colorBack="#00000000"
        image="https://shaders.paper.design/images/logos/diamond.svg"
        style={style}
      />
    </div>
  );
}

export { ChatHeatmap };
export type { ChatHeatmapProps };
