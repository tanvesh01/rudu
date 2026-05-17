import githubLogoUrl from "@/assets/provider-logos/github-invertocat-white.svg";
import linearLogoUrl from "@/assets/provider-logos/linear-light-logo.svg";
import type { IssueProvider } from "@/types/issues";

function LinearBadge() {
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-[#828fff] bg-gradient-to-b from-[#828fff] to-[#5f6cf2] px-2 text-xs font-medium text-white shadow-sm">
      <img
        alt=""
        aria-hidden="true"
        className="size-3 shrink-0"
        src={linearLogoUrl}
      />
      Linear
    </span>
  );
}

function GithubBadge() {
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-[#c7d1ca] bg-[#E4EBE6] px-2 text-xs font-medium text-[#26382d] shadow-sm">
      <img
        alt=""
        aria-hidden="true"
        className="size-3 shrink-0 invert"
        src={githubLogoUrl}
      />
      GitHub
    </span>
  );
}

function IssueProviderBadge({ provider }: { provider: IssueProvider }) {
  if (provider === "linear") {
    return <LinearBadge />;
  }

  return <GithubBadge />;
}

export { GithubBadge, IssueProviderBadge, LinearBadge };
