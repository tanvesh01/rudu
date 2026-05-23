import { useEffect } from "react";
import {
  createFileTreeIconResolver,
  getBuiltInFileIconColor,
  getBuiltInSpriteSheet,
} from "@pierre/trees";

const FILE_TREE_ICON_SPRITE_ID = "rudu-file-tree-icon-sprite";
const fileTreeIconResolver = createFileTreeIconResolver({
  set: "complete",
  colored: true,
});

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

function FileTreeAttachmentIcon({ path }: { path: string }) {
  const icon = fileTreeIconResolver.resolveIcon("file-tree-icon-file", path);
  const color = icon.token ? getBuiltInFileIconColor(icon.token) : undefined;

  useEffect(() => {
    ensureFileTreeIconSprite();
  }, []);

  return (
    <svg
      aria-hidden="true"
      className="size-3.5"
      data-icon-name={icon.remappedFrom ?? icon.name}
      data-icon-token={icon.token}
      style={color ? { color } : undefined}
      viewBox={icon.viewBox ?? `0 0 ${icon.width ?? 16} ${icon.height ?? 16}`}
    >
      <use href={`#${icon.name.replace(/^#/, "")}`} />
    </svg>
  );
}

export { FileTreeAttachmentIcon };
