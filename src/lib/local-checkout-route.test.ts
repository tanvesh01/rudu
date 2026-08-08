import { describe, expect, it } from "bun:test";
import {
  getLocalCheckoutRouteParams,
  getSelectedLocalCheckoutFromPathname,
} from "./local-checkout-route";

describe("local checkout route helpers", () => {
  it("round-trips checkout ids through route params and pathnames", () => {
    expect(getLocalCheckoutRouteParams("checkout abc")).toEqual({
      checkoutId: "checkout abc",
    });
    expect(
      getSelectedLocalCheckoutFromPathname("/local/checkout%20abc"),
    ).toBe("checkout abc");
  });

  it("rejects empty and unrelated routes", () => {
    expect(getLocalCheckoutRouteParams("  ")).toBeNull();
    expect(getSelectedLocalCheckoutFromPathname("/unknown")).toBeNull();
    expect(getSelectedLocalCheckoutFromPathname("/local/")).toBeNull();
  });
});
