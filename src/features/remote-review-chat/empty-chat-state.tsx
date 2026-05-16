import { ChatHeatmap } from "./empty-chat-heatmap";
import { WorkspaceActivityLog } from "./workspace-activity-log";
import type { ReviewWorkspaceActivityEntry } from "./workspace-activity-log";

type EmptyChatStateProps = {
  activityEntries: ReviewWorkspaceActivityEntry[];
  activityError: string | null;
  isPreparingWorkspace: boolean;
};

function EmptyChatState({
  activityEntries,
  activityError,
  isPreparingWorkspace,
}: EmptyChatStateProps) {
  return (
    <div className="flex min-h-full w-full flex-col justify-center space-y-5">
      <div className="space-y-3">
        <ChatHeatmap className="justify-center" />

        <div className="flex flex-col items-center">
          <p className="text-sm font-medium text-ink-800 mb-4">
            Start a Review Chat
          </p>
          <p className="text-sm text-ink-700 mb-1">Ask anything.</p>
          <p className="text-xs text-ink-500 text-center">
            You can mention PRs and issues in the chat too!
          </p>
        </div>
      </div>

      <WorkspaceActivityLog
        entries={activityEntries}
        error={activityError}
        isLoading={isPreparingWorkspace}
        showWhenIdle
      />
    </div>
  );
}

export { EmptyChatState };
export type { EmptyChatStateProps };
