import { useModelProviderLogo } from "../../features/review-chat/model-provider-assets";

function cx(...classes: Array<string | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function ModelProviderLogo({
  className,
  providerId,
}: {
  className?: string;
  providerId: string;
}) {
  const logoSvg = useModelProviderLogo(providerId);

  if (!logoSvg) {
    return null;
  }

  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-flex size-4 shrink-0 text-current [&_svg]:size-full",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: logoSvg }}
    />
  );
}

export { ModelProviderLogo };
