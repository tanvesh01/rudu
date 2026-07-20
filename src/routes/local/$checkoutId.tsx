import { createFileRoute } from "@tanstack/react-router";
import { LocalCheckoutWorkspace } from "../../components/local-checkout-workspace/local-checkout-workspace";

export const Route = createFileRoute("/local/$checkoutId")({
  component: LocalCheckoutRoute,
});

function LocalCheckoutRoute() {
  const { checkoutId } = Route.useParams();
  return <LocalCheckoutWorkspace checkoutId={checkoutId} />;
}
