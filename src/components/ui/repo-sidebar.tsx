import { PlusIcon } from "@heroicons/react/20/solid";
import { Accordion } from "./accordion";
import { RepoSidebarItem, type PullRequestSummary } from "./repo-sidebar-item";

type RepoSummary = {
  name: string;
  nameWithOwner: string;
  description: string | null;
  isPrivate: boolean | null;
};

type RepoSidebarProps = {
  repos: RepoSummary[];
  prsByRepo: Record<string, PullRequestSummary[]>;
  loadingRepos: Record<string, boolean>;
  repoErrors: Record<string, string>;
  defaultOpenValues: string[];
  onAddRepo: () => void;
  onSelectPr: (repo: string, pullRequest: PullRequestSummary) => void;
  onRepoOpenChange: (repo: string, open: boolean) => void;
};

function RepoSidebar({
  repos,
  prsByRepo,
  loadingRepos,
  repoErrors,
  defaultOpenValues,
  onAddRepo,
  onSelectPr,
  onRepoOpenChange,
}: RepoSidebarProps) {
  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-ink-300 bg-canvas md:border-b-0">
      <div className="flex w-full items-center gap-2.5  border-ink-200 px-3 py-2.5 text-sm font-medium">
        Repositories
        <button
          aria-label="Add repo"
          className="ml-auto inline-flex items-center justify-center rounded-md p-1 text-neutral-500 transition hover:bg-surface hover:text-ink-700"
          onClick={onAddRepo}
          type="button"
        >
          <PlusIcon className="size-3.5 shrink-0" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {repos.length === 0 ? (
          <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ink-300 bg-surface px-6 py-8 text-center">
            <strong>No repos yet.</strong>
            <span className="text-sm text-ink-600">
              Click + to pick from your GitHub repos.
            </span>
          </div>
        ) : (
          <Accordion multiple defaultValue={defaultOpenValues}>
            {repos.map((repo) => (
              <RepoSidebarItem
                key={repo.nameWithOwner}
                value={repo.nameWithOwner}
                nameWithOwner={repo.nameWithOwner}
                pullRequests={prsByRepo[repo.nameWithOwner]}
                isLoading={Boolean(loadingRepos[repo.nameWithOwner])}
                error={repoErrors[repo.nameWithOwner]}
                onSelectPr={(name, pr) => onSelectPr(name, pr)}
                onOpenChange={(open) =>
                  onRepoOpenChange(repo.nameWithOwner, open)
                }
              />
            ))}
          </Accordion>
        )}
      </div>
    </aside>
  );
}

export { RepoSidebar };
export type { RepoSidebarProps, RepoSummary };
