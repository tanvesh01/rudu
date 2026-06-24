import { useEffect } from "react";
import type { CSSProperties } from "react";
import {
  createFileTreeIconResolver,
  getBuiltInSpriteSheet,
} from "@pierre/trees";

const FILE_TREE_ICON_SPRITE_ID = "rudu-file-tree-icon-sprite";
const fileTreeIconResolver = createFileTreeIconResolver({
  set: "complete",
  colored: true,
});

const FILE_ICON_TOKEN_FALLBACK_COLORS: Record<string, string> = {
  astro: "#a631be",
  babel: "#d5a910",
  bash: "#199f43",
  biome: "#1a85d4",
  bootstrap: "#693acf",
  browserslist: "#d5a910",
  bun: "#594c5b",
  c: "#1a85d4",
  cpp: "#1a85d4",
  claude: "#d47628",
  css: "#693acf",
  database: "#a631be",
  default: "#84848a",
  docker: "#1a85d4",
  eslint: "#693acf",
  git: "#ff8c5b",
  go: "#1ca1c7",
  graphql: "#d32a61",
  html: "#d47628",
  image: "#d32a61",
  javascript: "#d5a910",
  json: "#d47628",
  markdown: "#199f43",
  mcp: "#17a5af",
  npm: "#d52c36",
  oxc: "#1ca1c7",
  postcss: "#d52c36",
  prettier: "#17a5af",
  python: "#1a85d4",
  react: "#1ca1c7",
  ruby: "#d52c36",
  rust: "#d47628",
  sass: "#d32a61",
  svg: "#d47628",
  svelte: "#d52c36",
  svgo: "#199f43",
  swift: "#d47628",
  table: "#17a5af",
  tailwind: "#1ca1c7",
  terraform: "#693acf",
  text: "#84848a",
  typescript: "#1a85d4",
  vite: "#a631be",
  vscode: "#1a85d4",
  vue: "#199f43",
  wasm: "#693acf",
  webpack: "#1a85d4",
  yml: "#d52c36",
  zig: "#d47628",
  zip: "#d47628",
};

type FileTreeIconProps = {
  className?: string;
  path: string;
};

function ensureFileTreeIconSprite() {
  if (typeof document === "undefined") return;
  if (document.getElementById(FILE_TREE_ICON_SPRITE_ID)) return;

  const container = document.createElement("div");
  container.id = FILE_TREE_ICON_SPRITE_ID;
  container.setAttribute("aria-hidden", "true");
  container.style.display = "none";
  container.innerHTML = getBuiltInSpriteSheet("complete");
  document.body.appendChild(container);
}

function getFileIconColor(token: string | undefined) {
  if (!token) return undefined;

  const fallback = FILE_ICON_TOKEN_FALLBACK_COLORS[token] ?? "currentColor";
  return `var(--trees-file-icon-color-${token}, var(--trees-file-icon-color, ${fallback}))`;
}

function FileTreeIcon({ className = "size-3.5", path }: FileTreeIconProps) {
  const icon = fileTreeIconResolver.resolveIcon("file-tree-icon-file", path);
  const color = getFileIconColor(icon.token);
  const style: CSSProperties | undefined = color ? { color } : undefined;

  useEffect(() => {
    ensureFileTreeIconSprite();
  }, []);

  return (
    <svg
      aria-hidden="true"
      className={className}
      data-icon-name={icon.remappedFrom ?? icon.name}
      data-icon-token={icon.token}
      style={style}
      viewBox={icon.viewBox ?? `0 0 ${icon.width ?? 16} ${icon.height ?? 16}`}
    >
      <use href={`#${icon.name.replace(/^#/, "")}`} />
    </svg>
  );
}

export { FileTreeIcon, getFileIconColor };
