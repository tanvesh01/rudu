import { MapIcon } from "@heroicons/react/20/solid";
import type { FileStatsEntry, ReviewWalkthrough } from "../../../../types/github";
import { ReviewWalkthroughGroupCard } from "./group-card";

type ReviewWalkthroughViewProps = {
  fileStatsByPath?: Map<string, FileStatsEntry> | null;
  walkthrough: ReviewWalkthrough;
  onSelectFile?: (path: string) => void;
};

function ReviewWalkthroughView({
  fileStatsByPath,
  walkthrough,
  onSelectFile,
}: ReviewWalkthroughViewProps) {
  return (
    <div className="space-y-3 py-3 text-sm text-ink-800 shadow-sm shadow-black/5">
      <div>
        <div className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-900">
          <MapIcon aria-hidden="true" className="size-4" />
          Review walkthrough
        </div>
        <p className="leading-5 text-ink-700 mb-4">
          {walkthrough.summary.focus}
        </p>
        <p className="mt-1 leading-5 text-ink-500">
          {walkthrough.summary.skim}
        </p>
      </div>

      <ol className="space-y-2">
        {walkthrough.groups.map((group, groupIndex) => (
          <ReviewWalkthroughGroupCard
            fileStatsByPath={fileStatsByPath}
            group={group}
            key={`${group.title}-${groupIndex}`}
            onSelectFile={onSelectFile}
          />
        ))}
      </ol>
    </div>
  );
}

export { ReviewWalkthroughView };
