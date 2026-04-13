import * as React from "react";
import {
  AccordionItem,
  AccordionHeader,
  AccordionTrigger,
  AccordionPanel,
} from "./accordion";
import { TruncateText } from "./truncate";

type PullRequestSummary = {
  number: number;
  title: string;
  state: string;
  authorLogin: string;
  updatedAt: string;
  url: string;
  headSha: string;
  baseSha: string | null;
};

type RepoSidebarItemProps = {
  value: string;
  nameWithOwner: string;
  pullRequests: PullRequestSummary[] | undefined;
  isLoading: boolean;
  error: string | undefined;
  onSelectPr: (repo: string, pr: PullRequestSummary) => void;
  onOpenChange: (open: boolean) => void;
};

function ChevronIcon(props: React.ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 12 12" fill="currentcolor" {...props}>
      <path d="M4.22 2.47a.75.75 0 0 1 1.06 0L8.53 5.72a.75.75 0 0 1 0 1.06L5.28 10.03a.75.75 0 0 1-1.06-1.06L6.97 6.25 4.22 3.53a.75.75 0 0 1 0-1.06Z" />
    </svg>
  );
}

function RepoSidebarItem({
  value,
  nameWithOwner,
  pullRequests,
  isLoading,
  error,
  onSelectPr,
  onOpenChange,
}: RepoSidebarItemProps) {
  return (
    <AccordionItem value={value} onOpenChange={onOpenChange}>
      <AccordionHeader>
        <AccordionTrigger className="group border-0 rounded-none font-normal">
          <ChevronIcon className="size-3.5 shrink-0 transition-[transform,opacity] duration-200 opacity-0 group-hover:opacity-100 [[data-panel-open]>&]:rotate-90 [[data-panel-open]>&]:opacity-100" />
          {nameWithOwner}
        </AccordionTrigger>
      </AccordionHeader>
      <AccordionPanel>
        <div className="overflow-hidden">
          <div className="flex flex-col gap-2 pl-4 pt-2">
            {isLoading ? (
              <div className="text-sm text-ink-500">Loading PRs...</div>
            ) : null}
            {error ? (
              <div className="text-sm text-danger-600">{error}</div>
            ) : null}
            {!isLoading && !error && pullRequests?.length === 0 ? (
              <div className="text-sm text-ink-500">No open PRs.</div>
            ) : null}
            {!isLoading && !error && pullRequests
              ? pullRequests.map((pullRequest) => {
                  const prKey = `${nameWithOwner}#${pullRequest.number}`;

                  return (
                    <button
                      className={[
                        "flex w-full flex-col gap-1 rounded-lg bg-canvas px-3 py-2.5 text-left transition hover:bg-surface focus-visible:bg-surface [--repo-row-bg:#F2F1ED] hover:[--repo-row-bg:#F7F7F3] focus-visible:[--repo-row-bg:#F7F7F3] [--truncate-marker-background-color:var(--repo-row-bg)]",
                      ].join(" ")}
                      key={prKey}
                      onClick={() => onSelectPr(nameWithOwner, pullRequest)}
                      type="button"
                    >
                      <p className="text-xs font-mono">
                        #{pullRequest.number} · {pullRequest.authorLogin}{" "}
                      </p>
                      <TruncateText className="text-sm">
                        {pullRequest.title}
                      </TruncateText>
                    </button>
                  );
                })
              : null}
          </div>
        </div>
      </AccordionPanel>
    </AccordionItem>
  );
}

export { RepoSidebarItem };
export type { RepoSidebarItemProps, PullRequestSummary };
