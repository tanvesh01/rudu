import type { PRStatus } from "../services/github/types.js";

interface PRStatusBadgeProps {
  prStatus: PRStatus | null;
  isLoading?: boolean;
  hasUncommittedChanges?: boolean;
  onRefresh?: () => void;
}

export function PRStatusBadge({
  prStatus,
  isLoading,
  hasUncommittedChanges,
  onRefresh,
}: PRStatusBadgeProps) {
  if (isLoading) {
    return (
      <box flexDirection="row" alignItems="center">
        <spinner name="dots" color="#666666" />
        <text content=" PR" fg="#666666" marginLeft={1} />
      </box>
    );
  }

  if (!prStatus) {
    if (hasUncommittedChanges) {
      return (
        <box flexDirection="row" alignItems="center">
          <text content="●" fg="#888888" marginRight={1} />
          <text content="Uncommitted" fg="#888888" />
        </box>
      );
    }
    return (
      <box flexDirection="row" alignItems="center">
        <text content="No PR" fg="#666666" />
      </box>
    );
  }

  const { state, number, hasConflicts, checks } = prStatus;

  if (state === "MERGED") {
    return (
      <box flexDirection="row" alignItems="center">
        <text content="✓" fg="#a855f7" marginRight={1} />
        <text content={`#${number} Merged`} fg="#a855f7" />
      </box>
    );
  }

  if (state === "CLOSED") {
    return (
      <box flexDirection="row" alignItems="center">
        <text content="○" fg="#666666" marginRight={1} />
        <text content={`#${number} Closed`} fg="#666666" />
      </box>
    );
  }

  if (!prStatus.exists) {
    if (hasUncommittedChanges) {
      return (
        <box flexDirection="row" alignItems="center">
          <text content="●" fg="#888888" marginRight={1} />
          <text content="Commit?" fg="#888888" />
        </box>
      );
    }
    return (
      <box flexDirection="row" alignItems="center">
        <text content="Create PR" fg="#3b82f6" />
      </box>
    );
  }

  const hasFailedChecks = checks?.some(
    (c) => c.status === "completed" && c.conclusion === "failure",
  );
  const hasPendingChecks = checks?.some(
    (c) => c.status === "queued" || c.status === "in_progress",
  );

  if (hasConflicts) {
    return (
      <box flexDirection="row" alignItems="center">
        <text content="⚠" fg="#ef4444" marginRight={1} />
        <text content={`#${number} Conflicts`} fg="#ef4444" />
      </box>
    );
  }

  if (hasFailedChecks) {
    return (
      <box flexDirection="row" alignItems="center">
        <text content="✗" fg="#eab308" marginRight={1} />
        <text content={`#${number} Checks failed`} fg="#eab308" />
      </box>
    );
  }

  if (hasPendingChecks) {
    return (
      <box flexDirection="row" alignItems="center">
        <spinner name="dots" color="#3b82f6" />
        <text content={` #${number} Checks`} fg="#3b82f6" marginLeft={1} />
      </box>
    );
  }

  return (
    <box flexDirection="row" alignItems="center">
      <text content="✓" fg="#22c55e" marginRight={1} />
      <text content={`#${number}`} fg="#22c55e" />
    </box>
  );
}