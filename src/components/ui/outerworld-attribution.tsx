function OuterworldAttribution() {
  return (
    <p className="pointer-events-auto absolute bottom-3 right-3 z-10 max-w-[18rem] text-right text-[10px] leading-tight text-white/60 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] sm:bottom-4 sm:right-4 sm:text-[11px]">
      Photo by{" "}
      <a
        className="underline decoration-white/30 underline-offset-2 transition hover:text-white/85"
        href="https://unsplash.com/@nicolasweldingh?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText"
        rel="noreferrer"
        target="_blank"
      >
        Nicolas Weldingh
      </a>{" "}
      on{" "}
      <a
        className="underline decoration-white/30 underline-offset-2 transition hover:text-white/85"
        href="https://unsplash.com/photos/a-mountain-range-with-a-body-of-water-in-the-foreground-Xcj8kbSpg_g?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText"
        rel="noreferrer"
        target="_blank"
      >
        Unsplash
      </a>
    </p>
  );
}

export { OuterworldAttribution };
