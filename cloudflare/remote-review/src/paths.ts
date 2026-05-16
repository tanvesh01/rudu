export function parseSessionIdPath(pathname: string, suffix = "") {
  const pattern = suffix
    ? new RegExp(`^/sessions/([^/]+)/${suffix}$`)
    : /^\/sessions\/([^/]+)$/;
  const match = pathname.match(pattern);
  if (!match) return null;
  return decodeURIComponent(match[1]);
}

export function validateSessionId(sessionId: string) {
  return sessionId.length > 0 && /^[a-z0-9-]+$/.test(sessionId);
}

export function normalizeTreePath(input: string | null | undefined) {
  const trimmed = (input ?? "").trim();
  if (trimmed === "" || trimmed === ".") {
    return "";
  }

  const parts = trimmed
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);

  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error("Path must stay within the indexed repository tree.");
  }

  return parts.join("/");
}
