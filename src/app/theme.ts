// Tokyo Night color palette for Rudu
// https://github.com/enkia/tokyo-night-vscode-theme

export const theme = {
  // Base colors
  bg: "#1a1b26",
  bgDark: "#16161e",
  bgHighlight: "#24283b",
  fg: "#a9b1d6",
  fgDark: "#565f89",
  fgLight: "#c0caf5",
  white: "#FFFFFF",

  // Accents
  blue: "#7aa2f7",
  cyan: "#7dcfff",
  green: "#9ece6a",
  orange: "#ff9e64",
  purple: "#bb9af7",
  red: "#f7768e",
  yellow: "#e0af68",

  // Status colors
  status: {
    queued: "#565f89", // muted blue-gray
    starting: "#e0af68", // yellow (transition)
    running: "#7aa2f7", // blue (active)
    cancelling: "#e0af68", // yellow (transition)
    succeeded: "#9ece6a", // green
    failed: "#f7768e", // red
    cancelled: "#565f89", // muted
  },

  // Stream colors for logs
  stream: {
    stdout: "#c0caf5", // light text
    stderr: "#f7768e", // red for errors
    system: "#565f89", // muted
  },

  // Transcript role colors
  role: {
    user: "#7aa2f7", // blue
    assistant: "#bb9af7", // purple
    tool: "#565f89", // muted
    system: "#565f89", // muted
  },

  // UI chrome
  ui: {
    headerBg: "#16161e",
    panelBg: "#1a1b26",
    selectedBg: "#283457", // highlighted selection
    border: "#24283b",
    muted: "#565f89",
  },

  // Text color aliases for components
  fgBright: "#c0caf5", // Light/bright text
  fgNormal: "#a9b1d6", // Normal text
  bgInput: "#24283b", // Input background
} as const;
