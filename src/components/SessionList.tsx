import type { SessionSnapshot } from "../services/SessionManager.js";
import { formatDuration } from "../domain/session.js";

interface SessionListProps {
  sessions: SessionSnapshot[];
  selectedId: string | null;
  focused: boolean;
  onSelect: (id: string) => void;
}

const statusColors: Record<string, string> = {
  queued: "#888888",
  starting: "#aaaaaa",
  running: "#ffffff",
  cancelling: "#aaaaaa",
  succeeded: "#cccccc",
  failed: "#888888",
  cancelled: "#666666",
};

function getSessionDisplayInfo(session: SessionSnapshot) {
  const now = Date.now();
  const duration = session.startedAt
    ? formatDuration((session.finishedAt ?? now) - session.startedAt)
    : formatDuration(now - session.queuedAt);

  return {
    name: session.title,
    description: `${session.status} | ${duration} | pid:${session.pid ?? "-"}`,
  };
}

export function SessionList({
  sessions,
  selectedId,
  focused,
  onSelect,
}: SessionListProps) {
  const options = sessions.map(getSessionDisplayInfo);
  const selectedIndex = sessions.findIndex((s) => s.id === selectedId);

  if (sessions.length === 0) {
    return (
      <box>
        <text content="No sessions yet. Press Ctrl+N to create one." fg="#666666" />
      </box>
    );
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      <select
        options={options}
        selectedIndex={Math.max(0, selectedIndex)}
        focused={focused}
        onChange={(index: number) => {
          const session = sessions[index];
          if (session) {
            onSelect(session.id);
          }
        }}
        height={Math.max(5, sessions.length + 2)}
        selectedBackgroundColor="#333333"
        selectedTextColor="#ffffff"
      />
    </box>
  );
}
