import type { LocalCheckout } from "../../types/local-checkouts";
import { LocalCheckoutRows } from "./repo-sidebar-item";

type LocalCheckoutListProps = {
  checkouts: LocalCheckout[];
  onSelectCheckout: (checkout: LocalCheckout) => void;
};

function LocalCheckoutList({
  checkouts,
  onSelectCheckout,
}: LocalCheckoutListProps) {
  return (
    <div className="flex flex-col">
      <LocalCheckoutRows
        checkouts={checkouts}
        onSelectCheckout={onSelectCheckout}
      />
    </div>
  );
}

export { LocalCheckoutList };
