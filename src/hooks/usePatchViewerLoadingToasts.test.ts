import { describe, expect, it } from "bun:test";
import {
  createPatchViewerLoadingToastController,
  getPatchViewerLoadingToastTitle,
} from "./usePatchViewerLoadingToasts";

type AddedToast = {
  id: string;
  title: string;
  onRemove: () => void;
};

function createToastRecorder() {
  const adds: AddedToast[] = [];
  const closes: string[] = [];
  const updates: Array<{ id: string; title: string }> = [];

  const controller = createPatchViewerLoadingToastController({
    add(toast) {
      adds.push({
        id: toast.id,
        title: toast.title,
        onRemove: toast.onRemove,
      });
    },
    close(id) {
      closes.push(id);
    },
    update(id, nextUpdates) {
      updates.push({
        id,
        title: nextUpdates.title,
      });
    },
  });

  return {
    adds,
    closes,
    controller,
    updates,
  };
}

describe("patch viewer loading toasts", () => {
  it("derives loading toast titles from patch and review-thread state", () => {
    expect(
      getPatchViewerLoadingToastTitle({
        hasSelection: true,
        isPatchLoading: true,
        patchError: "",
        isReviewThreadsLoading: false,
      }),
    ).toBe("Loading patch...");
    expect(
      getPatchViewerLoadingToastTitle({
        hasSelection: true,
        isPatchLoading: false,
        patchError: "",
        isReviewThreadsLoading: true,
      }),
    ).toBe("Loading review threads...");
    expect(
      getPatchViewerLoadingToastTitle({
        hasSelection: true,
        isPatchLoading: true,
        patchError: "failed",
        isReviewThreadsLoading: true,
      }),
    ).toBeNull();
  });

  it("does not add a duplicate keyed toast while the previous toast is closing", () => {
    const { adds, closes, controller } = createToastRecorder();
    const firstOwner = Symbol("first-owner");
    const nextOwner = Symbol("next-owner");

    controller.show(firstOwner, "Loading patch...");
    controller.hide(firstOwner);
    controller.show(nextOwner, "Loading review threads...");

    expect(adds).toHaveLength(1);
    expect(closes).toEqual(["patch-viewer-loading"]);

    adds[0].onRemove();

    expect(adds).toHaveLength(2);
    expect(adds[1]).toMatchObject({
      id: "patch-viewer-loading",
      title: "Loading review threads...",
    });
  });

  it("transfers ownership and updates the existing toast instead of adding again", () => {
    const { adds, closes, controller, updates } = createToastRecorder();
    const firstOwner = Symbol("first-owner");
    const nextOwner = Symbol("next-owner");

    controller.show(firstOwner, "Loading patch...");
    controller.show(nextOwner, "Loading review threads...");
    controller.hide(firstOwner);
    controller.hide(nextOwner);

    expect(adds).toHaveLength(1);
    expect(updates).toEqual([
      {
        id: "patch-viewer-loading",
        title: "Loading review threads...",
      },
    ]);
    expect(closes).toEqual(["patch-viewer-loading"]);
  });
});
