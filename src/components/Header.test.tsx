import { test, expect, afterEach } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { Header } from "./Header.js";

let testSetup: Awaited<ReturnType<typeof testRender>>;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
  }
});

test("Header renders Rudu title", async () => {
  testSetup = await testRender(<Header />, { width: 80, height: 24 });
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("Rudu");
});

test("Header shows prompt mode indicator", async () => {
  testSetup = await testRender(<Header mode="prompt" />, { width: 80, height: 24 });
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("PROMPT MODE");
});
