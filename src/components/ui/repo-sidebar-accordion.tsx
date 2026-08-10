import { Accordion } from "./accordion";
import { RepoSidebarItem, type PullRequestSummary } from "./repo-sidebar-item";
import type { RepositoryGroup } from "../../lib/repository-groups";
import type { LocalCheckout } from "../../types/local-checkouts";

type RepoSidebarAccordionProps = {
  groups: RepositoryGroup[];
  prsByRepo: Record<string, PullRequestSummary[]>;
  repoErrors: Record<string, string>;
  openValues: string[];
  selectedCheckoutId: string | null;
  selectedPrKey: string | null;
  onSelectCheckout: (checkout: LocalCheckout) => void;
  onRemoveCheckout: (checkout: LocalCheckout) => void;
  onSelectPr: (repo: string, pullRequest: PullRequestSummary) => void;
  onAddPr: (repo: string) => void;
  onRemovePr: (repo: string, pullRequest: PullRequestSummary) => void;
  onRepoOpenChange: (repo: string, open: boolean) => void;
};

function RepoSidebarAccordion({
  groups,
  prsByRepo,
  repoErrors,
  openValues,
  selectedCheckoutId,
  selectedPrKey,
  onSelectCheckout,
  onRemoveCheckout,
  onSelectPr,
  onAddPr,
  onRemovePr,
  onRepoOpenChange,
}: RepoSidebarAccordionProps) {
  return (
    <Accordion multiple value={openValues}>
      {groups.map((group) => (
        <RepoSidebarItem
          key={group.key}
          value={group.key}
          label={group.label}
          githubRepoName={group.githubRepo?.nameWithOwner ?? null}
          localCheckouts={group.localCheckouts}
          pullRequests={
            group.githubRepo
              ? prsByRepo[group.githubRepo.nameWithOwner]
              : undefined
          }
          error={
            group.githubRepo
              ? repoErrors[group.githubRepo.nameWithOwner]
              : undefined
          }
          selectedCheckoutId={selectedCheckoutId}
          selectedPrKey={selectedPrKey}
          onSelectCheckout={onSelectCheckout}
          onRemoveCheckout={onRemoveCheckout}
          onSelectPr={(name, pr) => onSelectPr(name, pr)}
          onAddPr={(name) => onAddPr(name)}
          onRemovePr={(name, pr) => onRemovePr(name, pr)}
          onOpenChange={(open) => onRepoOpenChange(group.key, open)}
        />
      ))}
    </Accordion>
  );
}

export { RepoSidebarAccordion };
export type { RepoSidebarAccordionProps };
