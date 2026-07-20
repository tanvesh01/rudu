const LOCAL_CHECKOUT_ROUTE = "/local/$checkoutId" as const;

function getLocalCheckoutRouteParams(checkoutId: string) {
  const normalizedId = checkoutId.trim();
  return normalizedId ? { checkoutId: normalizedId } : null;
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
  getSelectedLocalCheckoutFromPathname,
};
