import { test, expect, describe, beforeEach } from "bun:test";
import {
  deriveBranchName,
  deriveSiblingPath,
  previewWorktreeNames,
  archiveWorktree,
} from "./GitWorktreeService.js";
import { InMemoryWorktreeRepository } from "../persistence/SyncJsonlWorktreeRepository.js";

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

describe("archiveWorktree", () => {
  let repository: InMemoryWorktreeRepository;

  beforeEach(() => {
    repository = new InMemoryWorktreeRepository();
  });

  test("fails when worktree does not exist", () => {
    const result = archiveWorktree("non-existent-id", repository);
    expect(result.type).toBe("failure");
    expect(result.error).toContain("not found");
  });

  test("fails when worktree is not Rudu-managed", () => {
    repository.insertWorktree({
      id: "wt-1",
      title: "Test Worktree",
      path: "/tmp/test-worktree",
      branch: "rudu/test",
      status: "active",
      repoRoot: "/tmp/repo",
      isRuduManaged: false,
    });

    const result = archiveWorktree("wt-1", repository);
    expect(result.type).toBe("failure");
    expect(result.error).toContain("Only Rudu-managed worktrees");
  });

  test("fails when worktree directory does not exist", () => {
    repository.insertWorktree({
      id: "wt-1",
      title: "Test Worktree",
      path: "/nonexistent/path/to/worktree",
      branch: "rudu/test",
      status: "active",
      repoRoot: "/tmp/repo",
      isRuduManaged: true,
    });

    const result = archiveWorktree("wt-1", repository);
    expect(result.type).toBe("failure");
    expect(result.error).toContain("does not exist");
  });

  test("fails when worktree is already archived", () => {
    // Create a temporary directory for this test
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rudu-test-"));

    repository.insertWorktree({
      id: "wt-1",
      title: "Test Worktree",
      path: tmpDir,
      branch: "rudu/test",
      status: "archived",
      repoRoot: "/tmp/repo",
      isRuduManaged: true,
      archivedAt: Date.now(),
    });

    const result = archiveWorktree("wt-1", repository);
    expect(result.type).toBe("failure");
    expect(result.error).toContain("Cannot archive");

    // Cleanup
    fs.rmdirSync(tmpDir);
  });

  test("successfully archives an active worktree", () => {
    // Create a temporary directory for this test
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rudu-test-"));

    repository.insertWorktree({
      id: "wt-1",
      title: "Test Worktree",
      path: tmpDir,
      branch: "rudu/test",
      status: "active",
      repoRoot: "/tmp/repo",
      isRuduManaged: true,
    });

    const beforeArchive = Date.now();
    const result = archiveWorktree("wt-1", repository);
    const afterArchive = Date.now();

    expect(result.type).toBe("success");
    expect(result.worktree).toBeDefined();
    expect(result.worktree?.status).toBe("archived");
    expect(result.worktree?.archivedAt).toBeGreaterThanOrEqual(beforeArchive);
    expect(result.worktree?.archivedAt).toBeLessThanOrEqual(afterArchive);

    // Verify the directory still exists (preserved on disk)
    expect(fs.existsSync(tmpDir)).toBe(true);

    // Cleanup
    fs.rmdirSync(tmpDir);
  });

  test("successfully archives a worktree in creating status", () => {
    // Create a temporary directory for this test
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rudu-test-"));

    repository.insertWorktree({
      id: "wt-1",
      title: "Test Worktree",
      path: tmpDir,
      branch: "rudu/test",
      status: "creating",
      repoRoot: "/tmp/repo",
      isRuduManaged: true,
    });

    const result = archiveWorktree("wt-1", repository);

    expect(result.type).toBe("success");
    expect(result.worktree?.status).toBe("archived");

    // Cleanup
    fs.rmdirSync(tmpDir);
  });

  test("persists archived status and rehydrates correctly", () => {
    // Create a temporary directory for this test
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rudu-test-"));

    repository.insertWorktree({
      id: "wt-1",
      title: "Test Worktree",
      path: tmpDir,
      branch: "rudu/test",
      status: "active",
      repoRoot: "/tmp/repo",
      isRuduManaged: true,
    });

    // Archive the worktree
    archiveWorktree("wt-1", repository);

    // Verify rehydration: the worktree should have archived status
    const rehydrated = repository.getWorktree("wt-1");
    expect(rehydrated).toBeDefined();
    expect(rehydrated?.status).toBe("archived");
    expect(rehydrated?.archivedAt).toBeDefined();

    // Cleanup
    fs.rmdirSync(tmpDir);
  });
});
