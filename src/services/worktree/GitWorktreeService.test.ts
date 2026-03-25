import { test, expect, describe } from "bun:test";
import {
  deriveBranchName,
  deriveSiblingPath,
  previewWorktreeNames,
} from "./GitWorktreeService.js";

describe("deriveBranchName", () => {
  test("converts title to lowercase", () => {
    expect(deriveBranchName("MyFeature")).toBe("rudu/myfeature");
  });

  test("replaces spaces with hyphens", () => {
    expect(deriveBranchName("my new feature")).toBe("rudu/my-new-feature");
  });

  test("removes special characters", () => {
    expect(deriveBranchName("feature@v1.0!")).toBe("rudu/featurev10");
  });

  test("prefixes with rudu/ namespace", () => {
    expect(deriveBranchName("feature")).toBe("rudu/feature");
  });

  test("trims whitespace", () => {
    expect(deriveBranchName("  feature  ")).toBe("rudu/feature");
  });

  test("collapses multiple hyphens", () => {
    expect(deriveBranchName("feature   name")).toBe("rudu/feature-name");
  });

  test("removes leading and trailing hyphens", () => {
    expect(deriveBranchName("-feature-")).toBe("rudu/feature");
  });
});

describe("deriveSiblingPath", () => {
  test("creates sibling directory path", () => {
    const result = deriveSiblingPath("/home/user/projects/myrepo", "feature");
    expect(result).toBe("/home/user/projects/feature");
  });

  test("normalizes title to lowercase", () => {
    const result = deriveSiblingPath("/home/user/projects/myrepo", "MyFeature");
    expect(result).toBe("/home/user/projects/myfeature");
  });

  test("replaces spaces with hyphens", () => {
    const result = deriveSiblingPath("/home/user/projects/myrepo", "my feature");
    expect(result).toBe("/home/user/projects/my-feature");
  });

  test("removes special characters", () => {
    const result = deriveSiblingPath("/home/user/projects/myrepo", "feature@1.0");
    expect(result).toBe("/home/user/projects/feature10");
  });

  test("handles root-level repos", () => {
    // For root-level repos, the parent is empty, so we use the repo root as the parent
    // This creates /myrepo/feature which is technically not a sibling but a subdirectory
    // This is acceptable since truly root-level repos are rare in practice
    const result = deriveSiblingPath("/myrepo", "feature");
    expect(result).toBe("/myrepo/feature");
  });
});

describe("previewWorktreeNames", () => {
  test("returns preview without collision info", () => {
    const preview = previewWorktreeNames("/tmp/nonexistent-repo", "my feature");
    expect(preview.branch).toBe("rudu/my-feature");
    expect(preview.path).toMatch(/\/my-feature$/);
    // These will be false for non-existent paths/branches
    expect(typeof preview.branchExists).toBe("boolean");
    expect(typeof preview.pathExists).toBe("boolean");
  });
});
