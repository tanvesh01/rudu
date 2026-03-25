import { theme } from "../app/theme.js";

interface WelcomeScreenProps {
  onCreateWorktree: () => void;
}

/**
 * Welcome screen shown when a supported repository has zero visible worktrees.
 * Displays a clear message and the Ctrl+N shortcut to create a worktree.
 */
export function WelcomeScreen({ onCreateWorktree }: WelcomeScreenProps) {
  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      alignItems="center"
      justifyContent="center"
    >
      <text content="Welcome to Rudu" fg={theme.fgBright} />
      <text
        content="No worktrees yet."
        fg={theme.fgNormal}
        marginTop={1}
      />
      <text
        content="Press Ctrl+N to create your first worktree."
        fg={theme.fgDark}
        marginTop={1}
      />
    </box>
  );
}
