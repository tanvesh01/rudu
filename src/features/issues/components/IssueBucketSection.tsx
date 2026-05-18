import {
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
  InboxIcon,
  PlusCircleIcon,
} from "@heroicons/react/20/solid";
import type { ComponentType, SVGProps } from "react";
import { IssueRow } from "./IssueRow";
import type {
  IssueBuckets,
  IssueLinkedPullRequest,
  IssueSummary,
} from "@/types/issues";

type IssueBucketConfig = {
  key: keyof IssueBuckets;
  title: string;
  emptyMessage: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  headerClassName?: string;
  iconClassName?: string;
};

const ISSUE_BUCKETS: IssueBucketConfig[] = [
  {
    key: "inProgress",
    title: "In Progress",
    emptyMessage: "No issues in progress.",
    Icon: ArrowPathIcon,
    iconClassName: "text-yellow-500 dark:text-yellow-300",
  },
  {
    key: "assigned",
    title: "Assigned",
    emptyMessage: "No open issues assigned to you.",
    Icon: InboxIcon,
  },
  {
    key: "subscribed",
    title: "Subscribed",
    emptyMessage: "No subscribed issues.",
    Icon: ChatBubbleLeftRightIcon,
  },
  {
    key: "created",
    title: "Created",
    emptyMessage: "No issues created by you.",
    Icon: PlusCircleIcon,
  },
];

function IssueBucketSection({
  emptyMessage,
  headerClassName = "bg-surface",
  iconClassName = "text-ink-500",
  issues,
  Icon,
  onOpenLinkedPullRequest,
  title,
}: {
  emptyMessage: string;
  headerClassName?: string;
  iconClassName?: string;
  issues: IssueSummary[];
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  onOpenLinkedPullRequest: (pullRequest: IssueLinkedPullRequest) => void;
  title: string;
}) {
  return (
    <section className="space-y-2 py-2">
      <div
        className={[
          "flex items-center gap-2 rounded-md px-4 py-2.5",
          headerClassName,
        ].join(" ")}
      >
        <h2 className="inline-flex items-center gap-2 text-sm font-medium text-ink-800">
          <Icon
            aria-hidden="true"
            className={["size-4 shrink-0", iconClassName].join(" ")}
          />
          <span>{title}</span>
        </h2>
        <span className="text-sm font-semibold text-ink-500">
          {issues.length}
        </span>
      </div>

      <div>
        {issues.length === 0 ? (
          <div className="sr-only">{emptyMessage}</div>
        ) : (
          <div className="flex flex-col">
            {issues.map((issue) => (
              <IssueRow
                issue={issue}
                key={`${issue.provider}-${issue.id}-${issue.url}`}
                onOpenLinkedPullRequest={onOpenLinkedPullRequest}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export { ISSUE_BUCKETS, IssueBucketSection };
export type { IssueBucketConfig };
