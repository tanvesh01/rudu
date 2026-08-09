import type { LocalDiffSource } from "../types/local-checkouts";

const LOCAL_CHECKOUT_ROUTE = "/local/$checkoutId" as const;

type LocalCheckoutRouteSearch = { diff?: string };

function getLocalCheckoutRouteParams(checkoutId: string) {
  const normalizedId = checkoutId.trim();
  return normalizedId ? { checkoutId: normalizedId } : null;
}

function validateLocalCheckoutRouteSearch(
  search: Record<string, unknown>,
): LocalCheckoutRouteSearch {
  return typeof search.diff === "string" ? { diff: search.diff } : {};
}

function getLocalDiffSourceSearch(source?: LocalDiffSource) {
  return source ? { diff: JSON.stringify(source) } : {};
}

function parseLocalDiffSource(
  value: string | undefined,
): LocalDiffSource | null {
  if (!value) return null;
  try {
    const source = JSON.parse(value) as Record<string, unknown>;
    if (
      source.kind === "git_diff" &&
      (source.target === null || typeof source.target === "string") &&
      typeof source.staged === "boolean" &&
      typeof source.includeUntracked === "boolean" &&
      isStringArray(source.paths)
    ) {
      return source as LocalDiffSource;
    }
    if (
      source.kind === "git_show" &&
      (source.target === null || typeof source.target === "string") &&
      isStringArray(source.paths)
    ) {
      return source as LocalDiffSource;
    }
    if (source.kind === "patch" && typeof source.path === "string") {
      return source as LocalDiffSource;
    }
    if (
      source.kind === "files" &&
      typeof source.oldPath === "string" &&
      typeof source.newPath === "string"
    ) {
      return source as LocalDiffSource;
    }
  } catch {
    // Invalid URL state falls back to the working-tree review.
  }
  return null;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function getSelectedLocalCheckoutFromPathname(pathname: string) {
  const match = pathname.match(/^\/local\/([^/]+)$/);
  if (!match) return null;

  try {
    const checkoutId = decodeURIComponent(match[1]).trim();
    return checkoutId || null;
  } catch {
    return null;
  }
}

export {
  LOCAL_CHECKOUT_ROUTE,
  getLocalCheckoutRouteParams,
  getLocalDiffSourceSearch,
  getSelectedLocalCheckoutFromPathname,
  parseLocalDiffSource,
  validateLocalCheckoutRouteSearch,
};
