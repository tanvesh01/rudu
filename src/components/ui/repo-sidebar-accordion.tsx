import { Accordion } from "./accordion";
import { RepoSidebarItem, type PullRequestSummary } from "./repo-sidebar-item";
import type { RepoSummary } from "../../types/github";

type RepoSidebarAccordionProps = {
  repos: RepoSummary[];
  prsByRepo: Record<string, PullRequestSummary[]>;
  repoErrors: Record<string, string>;
  openValues: string[];
  selectedPrKey: string | null;
  onSelectPr: (repo: string, pullRequest: PullRequestSummary) => void;
  onAddPr: (repo: string) => void;
  onRemovePr: (repo: string, pullRequest: PullRequestSummary) => void;
  onRepoOpenChange: (repo: string, open: boolean) => void;
};

function RepoSidebarAccordion({
  repos,
  prsByRepo,
  repoErrors,
  openValues,
  selectedPrKey,
  onSelectPr,
  onAddPr,
  onRemovePr,
  onRepoOpenChange,
}: RepoSidebarAccordionProps) {
  return (
    <Accordion multiple value={openValues}>
      {repos.map((repo) => (
        <RepoSidebarItem
          key={repo.nameWithOwner}
          value={repo.nameWithOwner}
          nameWithOwner={repo.nameWithOwner}
          pullRequests={prsByRepo[repo.nameWithOwner]}
          error={repoErrors[repo.nameWithOwner]}
          selectedPrKey={selectedPrKey}
          onSelectPr={(name, pr) => onSelectPr(name, pr)}
          onAddPr={(name) => onAddPr(name)}
          onRemovePr={(name, pr) => onRemovePr(name, pr)}
          onOpenChange={(open) => onRepoOpenChange(repo.nameWithOwner, open)}
        />
      ))}
    </Accordion>
  );
}

export { RepoSidebarAccordion };
export type { RepoSidebarAccordionProps };
