import { describe, expect, test } from "bun:test";
import { parseSidebarSizes } from "./use-sidebar-sizes";

describe("parseSidebarSizes", () => {
  test("keeps valid sizes", () => {
    expect(parseSidebarSizes('{"left":280,"right":400}')).toEqual({
      left: 280,
      right: 400,
    });
  });

  test("falls back and clamps", () => {
    expect(parseSidebarSizes(null)).toEqual({ left: 320, right: 320 });
    expect(parseSidebarSizes("nope")).toEqual({ left: 320, right: 320 });
    expect(parseSidebarSizes('{"left":40,"right":900}')).toEqual({
      left: 180,
      right: 560,
    });
  });
});
