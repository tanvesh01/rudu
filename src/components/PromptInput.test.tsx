import { test, expect, afterEach } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { PromptInput } from "./PromptInput.js";

let testSetup: Awaited<ReturnType<typeof testRender>>;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
  }
});

test("PromptInput renders input prompt", async () => {
  testSetup = await testRender(
    <PromptInput focused={true} onSubmit={() => {}} onCancel={() => {}} />,
    { width: 80, height: 5 }
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain(">");
});

test("PromptInput shows placeholder", async () => {
  testSetup = await testRender(
    <PromptInput focused={true} onSubmit={() => {}} onCancel={() => {}} />,
    { width: 80, height: 5 }
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("prompt");
});
