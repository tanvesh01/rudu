import { FileTreeIcon } from "../../../components/ui/file-tree-icon";

function FileTreeAttachmentIcon({ path }: { path: string }) {
  return <FileTreeIcon className="size-3.5" path={path} />;
}

export { FileTreeAttachmentIcon };
