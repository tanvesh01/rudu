const modelProviderLogoSvgs = import.meta.glob(
  "../../assets/model-provider-logos/*.svg",
  {
    eager: true,
    import: "default",
    query: "?raw",
  },
) as Record<string, string>;

function cx(...classes: Array<string | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function getLogoSvg(providerId: string) {
  return (
    modelProviderLogoSvgs[`../../assets/model-provider-logos/${providerId}.svg`] ??
    modelProviderLogoSvgs["../../assets/model-provider-logos/synthetic.svg"]
  );
}

function ModelProviderLogo({
  className,
  providerId,
}: {
  className?: string;
  providerId: string;
}) {
  const logoSvg = getLogoSvg(providerId);

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
