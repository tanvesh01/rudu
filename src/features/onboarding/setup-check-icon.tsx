import type { ReactNode } from "react";
import { useModelProviderLogo } from "../review-chat/model-provider-assets";

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type SetupCheckIconFrameProps = {
  children: ReactNode;
  tone?: "github" | "neutral";
};

function SetupCheckIconFrame({
  children,
  tone = "neutral",
}: SetupCheckIconFrameProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full",
        tone === "github"
          ? "bg-[#24292f] text-white"
          : "bg-ink-100 text-ink-700 dark:bg-white/[0.08] dark:text-ink-100",
      )}
    >
      {children}
    </span>
  );
}

type AssetSetupCheckIconProps = {
  src: string;
};

function AssetSetupCheckIcon({ src }: AssetSetupCheckIconProps) {
  return (
    <SetupCheckIconFrame tone="github">
      <img alt="" aria-hidden="true" className="size-[18px]" src={src} />
    </SetupCheckIconFrame>
  );
}

type ProviderSetupCheckIconProps = {
  fallback: string;
  providerId: string;
};

function ProviderSetupCheckIcon({
  fallback,
  providerId,
}: ProviderSetupCheckIconProps) {
  const logoSvg = useModelProviderLogo(providerId);

  return (
    <SetupCheckIconFrame>
      {logoSvg ? (
        <span
          className="inline-flex size-4 dark:invert [&_svg]:block [&_svg]:size-full"
          dangerouslySetInnerHTML={{ __html: logoSvg }}
        />
      ) : (
        <span className="text-xs font-semibold">{fallback}</span>
      )}
    </SetupCheckIconFrame>
  );
}

export { AssetSetupCheckIcon, ProviderSetupCheckIcon };
