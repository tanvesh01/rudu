import { describe, expect, it } from "bun:test";
import { getReactDiagnosticsMode } from "./react-diagnostics";

describe("getReactDiagnosticsMode", () => {
  it("enables React Scan in Vite development mode", () => {
    expect(getReactDiagnosticsMode({ DEV: true })).toEqual({
      enabled: true,
      log: false,
      trackUnnecessaryRenders: false,
    });
  });

  it("keeps React Scan disabled outside development by default", () => {
    expect(getReactDiagnosticsMode({ DEV: false, MODE: "production" })).toEqual({
      enabled: false,
      log: false,
      trackUnnecessaryRenders: false,
    });
  });

  it("allows explicit scan, render logging, and unnecessary-render tracking flags", () => {
    expect(
      getReactDiagnosticsMode({
        DEV: false,
        MODE: "production",
        VITE_REACT_SCAN: "true",
        VITE_REACT_SCAN_LOG: "1",
        VITE_REACT_SCAN_UNNECESSARY: "yes",
      }),
    ).toEqual({
      enabled: true,
      log: true,
      trackUnnecessaryRenders: true,
    });
  });
});
