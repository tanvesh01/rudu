import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./alert-dialog";
import type { RepoSummary } from "./repo-sidebar";
import { getOwnerAvatarUrl, getOwnerLogin } from "../../lib/github-owner";

type AddRepoModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  isLoadingRepos: boolean;
  availableReposError: unknown;
  availableRepos: RepoSummary[];
  filteredRepos: RepoSummary[];
  isAddingRepo: boolean;
  onPickRepo: (repo: RepoSummary) => void;
};

function AddRepoModal({
  open,
  onOpenChange,
  searchQuery,
  onSearchChange,
  isLoadingRepos,
  availableReposError,
  availableRepos,
  filteredRepos,
  isAddingRepo,
  onPickRepo,
}: AddRepoModalProps) {
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Add a repo</AlertDialogTitle>
          <AlertDialogDescription>
            Search your GitHub repos (user + orgs). Click to add.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="my-4 flex min-h-0 flex-col gap-2.5">
          <input
            autoFocus
            className="w-full rounded-xl border border-ink-300 bg-surface px-3 py-2.5 outline-none transition placeholder:text-ink-500 focus:border-zinc-400"
            disabled={isLoadingRepos}
            onChange={(event) => onSearchChange(event.currentTarget.value)}
            placeholder="Search repos..."
            value={searchQuery}
          />

          {isLoadingRepos ? (
            <div className="px-0 py-2 text-sm text-ink-500">Loading repos via gh...</div>
          ) : null}

          {availableReposError ? (
            <div className="text-sm text-danger-600">
              {availableReposError instanceof Error
                ? availableReposError.message
                : String(availableReposError)}
            </div>
          ) : null}

          {!isLoadingRepos && !availableReposError ? (
            <div className="flex max-h-[340px] flex-col gap-1 overflow-y-auto">
              {filteredRepos.length === 0 ? (
                <div className="px-0 py-2 text-sm text-ink-500">
                  {availableRepos.length === 0 ? "No repos found." : "No matching repos."}
                </div>
              ) : (
                filteredRepos.map((repo) => (
                  <button
                    className="w-full rounded-lg border border-ink-200 bg-surface px-3 py-2.5 text-left transition hover:border-zinc-400 hover:bg-canvas disabled:cursor-default disabled:opacity-60"
                    disabled={isAddingRepo}
                    key={repo.nameWithOwner}
                    onClick={() => onPickRepo(repo)}
                    type="button"
                  >
                    <div className="flex items-start gap-2.5">
                      <img
                        alt={`${getOwnerLogin(repo.nameWithOwner)} avatar`}
                        className="mt-0.5 size-5 shrink-0 rounded-full border border-ink-300 object-cover"
                        loading="lazy"
                        src={getOwnerAvatarUrl(repo.nameWithOwner)}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          <span className="truncate">{repo.nameWithOwner}</span>
                          {repo.isPrivate ? (
                            <span className="rounded bg-[#f0f0f5] px-1.5 py-px text-[11px] font-medium text-ink-500 dark:bg-ink-100/10 dark:text-ink-400">
                              Private
                            </span>
                          ) : null}
                        </div>
                        {repo.description ? (
                          <div className="mt-1 truncate text-sm text-ink-500">
                            {repo.description}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isAddingRepo} type="button">
            Cancel
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export { AddRepoModal };
export type { AddRepoModalProps };
