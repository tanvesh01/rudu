import { createFileRoute } from "@tanstack/react-router";
import { LocalCheckoutListScreen } from "../../components/app-shell/local-checkout-list-screen";

export const Route = createFileRoute("/local/")({
  component: LocalCheckoutListScreen,
});
