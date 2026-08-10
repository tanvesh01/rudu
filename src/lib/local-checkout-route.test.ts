import { describe, expect, it } from "bun:test";
import {
  getLocalCheckoutRouteParams,
  getLocalDiffSourceSearch,
  getSelectedLocalCheckoutFromPathname,
  parseLocalDiffSource,
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

  it("round-trips explicit diff sources through route search", () => {
    const source = {
      kind: "git_diff" as const,
      target: "main...HEAD",
      staged: false,
      includeUntracked: true,
      paths: ["src"],
    };
    expect(parseLocalDiffSource(getLocalDiffSourceSearch(source).diff)).toEqual(
      source,
    );
    expect(parseLocalDiffSource("not-json")).toBeNull();
  });

  it("rejects empty and unrelated routes", () => {
    expect(getLocalCheckoutRouteParams("  ")).toBeNull();
    expect(getSelectedLocalCheckoutFromPathname("/unknown")).toBeNull();
    expect(getSelectedLocalCheckoutFromPathname("/local/")).toBeNull();
  });
});
