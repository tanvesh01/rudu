import { useState, useCallback } from "react";
import { theme } from "../app/theme.js";

export interface CreateWorktreeDialogProps {
  repoRoot: string;
  defaultBranch: string;
  onSubmit: (title: string) => void;
  onCancel: () => void;
}

interface DerivedPreviews {
  branch: string;
  path: string;
}

/**
 * Derives a valid git branch name from a worktree title.
 * - Converts to lowercase
 * - Replaces spaces and special chars with hyphens
 * - Removes invalid characters
 */
function deriveBranchName(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Derives a sibling directory path for the worktree.
 * The worktree is created as a sibling to the repo root.
 */
function deriveSiblingPath(repoRoot: string, title: string): string {
  const parentDir = repoRoot.substring(0, repoRoot.lastIndexOf("/")) || repoRoot;
  const normalizedTitle = title
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${parentDir}/${normalizedTitle}`;
}

/**
 * Calculates derived branch and path previews from a title.
 */
function calculatePreviews(
  repoRoot: string,
  title: string,
): DerivedPreviews | null {
  const trimmed = title.trim();
  if (!trimmed) {
    return null;
  }
  return {
    branch: deriveBranchName(trimmed),
    path: deriveSiblingPath(repoRoot, trimmed),
  };
}

/**
 * Validates if a title is acceptable for creating a worktree.
 */
function validateTitle(title: string): { valid: boolean; error?: string } {
  const trimmed = title.trim();
  if (!trimmed) {
    return { valid: false, error: "Title is required" };
  }
  if (trimmed.length < 2) {
    return { valid: false, error: "Title must be at least 2 characters" };
  }
  if (!/^\w[\w\s-]*$/.test(trimmed)) {
    return { valid: false, error: "Title can only contain letters, numbers, spaces, and hyphens" };
  }
  return { valid: true };
}

/**
 * Dialog for creating a new worktree.
 * Shows title input with derived branch and path previews.
 * Blocks invalid submissions with visible validation.
 */
export function CreateWorktreeDialog({
  repoRoot,
  defaultBranch,
  onSubmit,
  onCancel,
}: CreateWorktreeDialogProps) {
  const [title, setTitle] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const previews = calculatePreviews(repoRoot, title);

  const handleTitleChange = useCallback((value: string) => {
    setTitle(value);
    // Clear validation error when user types
    if (validationError) {
      setValidationError(null);
    }
  }, [validationError]);

  const handleSubmit = useCallback(() => {
    setAttemptedSubmit(true);
    const validation = validateTitle(title);
    if (!validation.valid) {
      setValidationError(validation.error ?? "Invalid title");
      return;
    }
    onSubmit(title.trim());
  }, [title, onSubmit]);

  // Show validation error when attempting to submit with invalid title
  const showValidationError = attemptedSubmit && validationError;

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      alignItems="center"
      justifyContent="center"
    >
      <box
        flexDirection="column"
        paddingX={2}
        paddingY={1}
        borderStyle="single"
        width={60}
      >
        <text content="Create New Worktree" fg={theme.fgBright} />

        <text content="Title:" fg={theme.fgNormal} marginTop={1} />
        <input
          value={title}
          onChange={handleTitleChange}
          focused={true}
          placeholder="Enter worktree title..."
        />

        {showValidationError && (
          <text content={validationError ?? ""} fg={theme.status.failed} marginTop={1} />
        )}

        {previews && (
          <box flexDirection="column" marginTop={1}>
            <text content="Preview:" fg={theme.ui.muted} />
            <text
              content={`  Branch: ${previews.branch}`}
              fg={theme.fgNormal}
            />
            <text content={`  Path: ${previews.path}`} fg={theme.fgNormal} />
          </box>
        )}

        <text
          content="Enter Submit | Escape Cancel"
          fg={theme.ui.muted}
          marginTop={1}
        />
      </box>
    </box>
  );
}
