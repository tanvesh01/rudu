import { ChevronRightIcon } from "@heroicons/react/20/solid";
import { Collapsible } from "@base-ui/react/collapsible";
import { useState } from "react";
import type { FileStatsEntry, ReviewWalkthrough } from "../../../../types/github";
import { ReviewWalkthroughFileRow } from "./file-row";
import { ReviewWalkthroughHeaderFileStack } from "./header-file-stack";

function ReviewWalkthroughGroupCard({
  fileStatsByPath,
  group,
  onSelectFile,
}: {
  fileStatsByPath?: Map<string, FileStatsEntry> | null;
  group: ReviewWalkthrough["groups"][number];
  onSelectFile?: (path: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <li>
      <Collapsible.Root
        className="rounded-lg border border-ink-100 bg-ink-50/80 shadow-sm shadow-black/5 dark:border-ink-200 dark:bg-ink-100/60"
        onOpenChange={setIsOpen}
        open={isOpen}
      >
        <div className="rounded-lg transition hover:bg-white/70 dark:hover:bg-ink-100">
          <Collapsible.Trigger className="group flex w-full items-start gap-2 px-2.5 py-2 text-left mb-2">
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center justify-between gap-3 mb-2">
                <span className="block min-w-0 truncate font-medium leading-5 text-ink-900">
                  {group.title}
                </span>
              </span>
              <span className="mt-0.5 block max-w-60 text-xs leading-4 text-ink-500">
                {group.reason}
              </span>
            </span>
            <ChevronRightIcon
              aria-hidden="true"
              className="mt-1 size-4 shrink-0 text-ink-400 transition-transform group-data-[panel-open]:rotate-90"
            />
          </Collapsible.Trigger>
          <div
            className={[
              "-mt-1 grid px-2.5 transition-[grid-template-rows,opacity,transform,filter,padding] duration-200 ease-out",
              isOpen
                ? "grid-rows-[0fr] opacity-0 -translate-y-1 blur-sm pb-0"
                : "grid-rows-[1fr] opacity-100 translate-y-0 blur-0 pb-2",
            ].join(" ")}
          >
            <div className="min-h-0 overflow-hidden">
              <ReviewWalkthroughHeaderFileStack
                fileStatsByPath={fileStatsByPath}
                files={group.files}
                onSelectFile={onSelectFile}
              />
            </div>
          </div>
        </div>
        <Collapsible.Panel className="border-t border-ink-100 px-2.5 pb-2.5 pt-2">
          <ul className="space-y-6">
            {group.files.map((file) => (
              <ReviewWalkthroughFileRow
                file={file}
                fileStatsByPath={fileStatsByPath}
                key={file.path}
                onSelectFile={onSelectFile}
              />
            ))}
          </ul>
        </Collapsible.Panel>
      </Collapsible.Root>
    </li>
  );
}

export { ReviewWalkthroughGroupCard };
