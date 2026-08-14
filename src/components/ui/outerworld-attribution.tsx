import * as stylex from "@stylexjs/stylex";

function OuterworldAttribution() {
  return (
    <p {...stylex.props(styles.root)}>
      Photo by{" "}
      <a
        href="https://unsplash.com/@nicolasweldingh?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText"
        rel="noreferrer"
        {...stylex.props(styles.link)}
        target="_blank"
      >
        Nicolas Weldingh
      </a>{" "}
      on{" "}
      <a
        href="https://unsplash.com/photos/a-mountain-range-with-a-body-of-water-in-the-foreground-Xcj8kbSpg_g?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText"
        rel="noreferrer"
        {...stylex.props(styles.link)}
        target="_blank"
      >
        Unsplash
      </a>
    </p>
  );
}

const styles = stylex.create({
  root: {
    pointerEvents: "auto",
    position: "absolute",
    bottom: {
      default: "0.75rem",
      "@media (min-width: 640px)": "1rem",
    },
    right: {
      default: "0.75rem",
      "@media (min-width: 640px)": "1rem",
    },
    zIndex: 10,
    maxWidth: "18rem",
    textAlign: "right",
    fontSize: {
      default: 10,
      "@media (min-width: 640px)": 11,
    },
    lineHeight: 1.25,
    color: "rgb(255 255 255 / 0.6)",
    filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.9))",
  },
  link: {
    textDecorationLine: "underline",
    textDecorationColor: "rgb(255 255 255 / 0.3)",
    textUnderlineOffset: 2,
    transitionProperty: "color",
    transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
    transitionDuration: "150ms",
    color: {
      default: null,
      ":hover": "rgb(255 255 255 / 0.85)",
    },
  },
});

export { OuterworldAttribution };
