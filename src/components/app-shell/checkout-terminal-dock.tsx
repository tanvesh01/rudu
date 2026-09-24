import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { LocalCheckout } from "../../types/local-checkouts";
import { GhosttyTerminalPanel } from "./ghostty-terminal-panel";

type CheckoutTerminalDockValue = {
  attach: (node: HTMLDivElement | null) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
};

const CheckoutTerminalContext = createContext<CheckoutTerminalDockValue | null>(null);

function useCheckoutTerminalDock() {
  const dock = useContext(CheckoutTerminalContext);
  if (!dock) throw new Error("Checkout terminal dock is unavailable");
  return dock;
}

function CheckoutTerminalDock({ children, checkoutId, checkouts, rightOpen }: {
  children: ReactNode;
  checkoutId: string | null;
  checkouts: LocalCheckout[] | undefined;
  rightOpen: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [openedIds, setOpenedIds] = useState<string[]>([]);
  // Moving the host preserves Ghostty instances and their scrollback.
  const [host] = useState(() => {
    const node = document.createElement("div");
    node.className = "h-full min-h-0 min-w-0";
    return node;
  });
  const parking = useRef<HTMLDivElement>(null);
  const attach = useCallback((node: HTMLDivElement | null) => {
    (node ?? parking.current)?.appendChild(host);
  }, [host]);

  useEffect(() => {
    if (!checkouts) return;
    const tracked = new Set(checkouts.map((checkout) => checkout.id));
    setOpenedIds((current) => current.filter((id) => tracked.has(id)));
  }, [checkouts]);

  useEffect(() => {
    if (!open || !checkoutId || !checkouts?.some((checkout) => checkout.id === checkoutId)) return;
    setOpenedIds((current) => current.includes(checkoutId) ? current : [...current, checkoutId]);
  }, [open, checkoutId, checkouts]);

  return <CheckoutTerminalContext.Provider value={{ attach, open, setOpen }}>
    <div className="min-h-0 min-w-0 flex-1">{children}</div>
    <div ref={parking} className="hidden" />
    {/* ponytail: keep opened views mounted for live scrollback; add snapshots if many checkouts make this costly. */}
    {openedIds.map((id) => <GhosttyTerminalPanel
      key={id}
      checkoutId={id}
      host={host}
      visible={open && rightOpen && checkoutId === id}
    />)}
  </CheckoutTerminalContext.Provider>;
}

export { CheckoutTerminalDock, useCheckoutTerminalDock };
