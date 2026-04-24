import { describe, expect, it } from "bun:test";
import { createDiffNavigatorController } from "./use-diff-navigator";

function createFakeNode() {
  let callCount = 0;
  let lastOptions: ScrollIntoViewOptions | undefined;

  return {
    node: {
      scrollIntoView(options?: ScrollIntoViewOptions) {
        callCount += 1;
        lastOptions = options;
      },
    },
    getCallCount() {
      return callCount;
    },
    getLastOptions() {
      return lastOptions;
    },
  };
}

function createController(options?: {
  prKey?: string | null;
  isDiffReady?: boolean;
  hasDiffError?: boolean;
}) {
  let selectedFilePath: string | null = null;

  const controller = createDiffNavigatorController({
    prKey: options?.prKey ?? "repo#1@sha",
    isDiffReady: options?.isDiffReady ?? true,
    hasDiffError: options?.hasDiffError ?? false,
    onSelectedFilePathChange(path) {
      selectedFilePath = path;
    },
  });

  return {
    controller,
    getSelectedFilePath() {
      return selectedFilePath;
    },
  };
}

describe("createDiffNavigatorController", () => {
  it("queues pending navigation when selecting a file without an anchor", () => {
    const { controller, getSelectedFilePath } = createController();

    controller.onSelectFile("src/app.ts");

    expect(getSelectedFilePath()).toBe("src/app.ts");
    expect(controller.getState().pendingScrollPath).toBe("src/app.ts");
  });

  it("does not flush pending navigation while diff is not ready or has an error", () => {
    const { controller } = createController({
      isDiffReady: false,
    });
    const firstNode = createFakeNode();

    controller.registerDiffNode("src/app.ts", firstNode.node as HTMLDivElement);
    controller.onSelectFile("src/app.ts");
    expect(firstNode.getCallCount()).toBe(0);

    controller.setReadiness(true, true);
    expect(firstNode.getCallCount()).toBe(0);
    expect(controller.getState().pendingScrollPath).toBe("src/app.ts");
  });

  it("flushes pending navigation when a matching anchor is registered and diff is ready", () => {
    const { controller } = createController();
    const node = createFakeNode();

    controller.onSelectFile("src/app.ts");
    expect(controller.getState().pendingScrollPath).toBe("src/app.ts");

    controller.registerDiffNode("src/app.ts", node.node as HTMLDivElement);

    expect(node.getCallCount()).toBe(1);
    expect(node.getLastOptions()).toEqual({
      behavior: "auto",
      block: "start",
      inline: "nearest",
    });
    expect(controller.getState().pendingScrollPath).toBeNull();
  });

  it("resets selection and pending state when PR key changes", () => {
    const { controller, getSelectedFilePath } = createController({
      prKey: "repo#1@shaA",
    });

    controller.onSelectFile("src/app.ts");
    expect(getSelectedFilePath()).toBe("src/app.ts");
    expect(controller.getState().pendingScrollPath).toBe("src/app.ts");

    controller.setPrKey("repo#2@shaB");

    expect(getSelectedFilePath()).toBeNull();
    expect(controller.getState().pendingScrollPath).toBeNull();
  });

  it("restabilizes valid selection on content change", () => {
    const { controller, getSelectedFilePath } = createController();
    const node = createFakeNode();

    controller.registerDiffNode("src/app.ts", node.node as HTMLDivElement);
    controller.onSelectFile("src/app.ts");
    expect(node.getCallCount()).toBe(1);

    controller.notifyDiffContentChanged();

    expect(getSelectedFilePath()).toBe("src/app.ts");
    expect(node.getCallCount()).toBe(2);
    expect(controller.getState().pendingScrollPath).toBeNull();
  });

  it("clears selection when selected file no longer exists after content changes", () => {
    const { controller, getSelectedFilePath } = createController();
    const selectedNode = createFakeNode();
    const otherNode = createFakeNode();

    controller.registerDiffNode(
      "src/selected.ts",
      selectedNode.node as HTMLDivElement,
    );
    controller.registerDiffNode("src/other.ts", otherNode.node as HTMLDivElement);
    controller.onSelectFile("src/selected.ts");
    expect(getSelectedFilePath()).toBe("src/selected.ts");

    controller.registerDiffNode("src/selected.ts", null);
    controller.notifyDiffContentChanged();

    expect(getSelectedFilePath()).toBeNull();
    expect(controller.getState().pendingScrollPath).toBeNull();
  });
});
