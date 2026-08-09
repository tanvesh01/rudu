import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { LocalCheckoutWorkspace } from "../../components/local-checkout-workspace/local-checkout-workspace";
import {
  parseLocalDiffSource,
  validateLocalCheckoutRouteSearch,
} from "../../lib/local-checkout-route";

export const Route = createFileRoute("/local/$checkoutId")({
  component: LocalCheckoutRoute,
  validateSearch: validateLocalCheckoutRouteSearch,
});

function LocalCheckoutRoute() {
  const { checkoutId } = Route.useParams();
  const { diff } = Route.useSearch();
  const source = useMemo(() => parseLocalDiffSource(diff), [diff]);
  return <LocalCheckoutWorkspace checkoutId={checkoutId} source={source} />;
}
