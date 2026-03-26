import { test, expect, afterEach } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { Footer } from "./Footer.js";

let testSetup: Awaited<ReturnType<typeof testRender>>;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
  }
});

test("Footer shows list mode shortcuts", async () => {
  testSetup = await testRender(<Footer mode="list" />, { width: 120, height: 5 });
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("Ctrl+N");
  expect(frame).toContain("Q Quit");
});

test("Footer shows prompt mode shortcuts", async () => {
  testSetup = await testRender(<Footer mode="prompt" />, { width: 80, height: 5 });
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("Enter Submit");
  expect(frame).toContain("Escape Cancel");
});

test("Footer shows archive and delete shortcuts when no session is selected", async () => {
  testSetup = await testRender(
    <Footer mode="list" hasSelectedSession={false} />,
    { width: 120, height: 5 }
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();

  // Should show archive and delete shortcuts along with basic navigation
  expect(frame).toContain("Ctrl+A");
  expect(frame).toContain("Archive");
  expect(frame).toContain("Ctrl+D");
  expect(frame).toContain("Delete");
  expect(frame).toContain("Ctrl+N");
  expect(frame).toContain("Q Quit");
  expect(frame).not.toContain("Ctrl+C");
  expect(frame).not.toContain("Enter Focus Chat");
  expect(frame).not.toContain("Ctrl+L");
});

test("Footer shows full shortcuts when session is selected", async () => {
  testSetup = await testRender(
    <Footer mode="list" hasSelectedSession={true} />,
    { width: 120, height: 5 }
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();

  // Should show full footer with chat/cancel affordances
  expect(frame).toContain("Ctrl+N");
  expect(frame).toContain("Ctrl+C");
  expect(frame).toContain("Enter Focus Chat");
  expect(frame).toContain("Ctrl+L");
  expect(frame).toContain("Q Quit");
});
