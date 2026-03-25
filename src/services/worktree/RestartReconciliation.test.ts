import { describe, expect, it, beforeEach } from "bun:test";
import {
  reconcileWorktreesOnRestart,
  recoverInterruptedSession,
} from "./RestartReconciliation.js";
import { InMemoryWorktreeRepository } from "../persistence/SyncJsonlWorktreeRepository.js";
import type { NewPersistedWorktree } from "../persistence/worktree-schemas.js";

describe("RestartReconciliation", () => {
  describe("recoverInterruptedSession", () => {
    it("converts queued status to failed recovered", () => {
      const result = recoverInterruptedSession("queued");
      expect(result).toEqual({
        status: "failed",
        recovered: true,
        error: "Session interrupted by app restart",
      });
    });

    it("converts starting status to failed recovered", () => {
      const result = recoverInterruptedSession("starting");
      expect(result).toEqual({
        status: "failed",
        recovered: true,
        error: "Session interrupted by app restart",
      });
    });

    it("converts running status to failed recovered", () => {
      const result = recoverInterruptedSession("running");
      expect(result).toEqual({
        status: "failed",
        recovered: true,
        error: "Session interrupted by app restart",
      });
    });

    it("converts cancelling status to failed recovered", () => {
      const result = recoverInterruptedSession("cancelling");
      expect(result).toEqual({
        status: "failed",
        recovered: true,
        error: "Session interrupted by app restart",
      });
    });

    it("returns null for terminal succeeded status", () => {
      const result = recoverInterruptedSession("succeeded");
      expect(result).toBeNull();
    });

    it("returns null for terminal failed status", () => {
      const result = recoverInterruptedSession("failed");
      expect(result).toBeNull();
    });

    it("returns null for terminal cancelled status", () => {
      const result = recoverInterruptedSession("cancelled");
      expect(result).toBeNull();
    });
  });

  describe("reconcileWorktreesOnRestart", () => {
    let repository: InMemoryWorktreeRepository;

    beforeEach(() => {
      repository = new InMemoryWorktreeRepository();
    });

    it("returns empty results when no worktrees exist", () => {
      const result = reconcileWorktreesOnRestart("/fake/repo", repository);

      expect(result.validWorktrees).toHaveLength(0);
      expect(result.missingWorktrees).toHaveLength(0);
      expect(result.recoveredWorktreeIds).toHaveLength(0);
    });

    it("marks worktrees with non-existent paths as missing", () => {
      // Insert a worktree with a path that doesn't exist
      repository.insertWorktree({
        id: "wt-missing-path",
        title: "Missing Path Worktree",
        path: "/definitely/not/a/real/path/worktree",
        branch: "rudu/feature",
        status: "active",
        repoRoot: "/repo",
        isRuduManaged: true,
      });

      const result = reconcileWorktreesOnRestart("/repo", repository);

      expect(result.validWorktrees).toHaveLength(0);
      expect(result.missingWorktrees).toHaveLength(1);
      expect(result.missingWorktrees[0]!.worktree.id).toBe("wt-missing-path");
      expect(result.missingWorktrees[0]!.reason).toBe("path_not_exists");
      expect(result.recoveredWorktreeIds).toContain("wt-missing-path");

      // Verify the worktree was updated in persistence
      const updated = repository.getWorktree("wt-missing-path");
      expect(updated?.status).toBe("cleanup_failed");
      expect(updated?.error).toContain("path no longer exists");
    });

    it("excludes already removed worktrees from reconciliation", () => {
      repository.insertWorktree({
        id: "wt-removed",
        title: "Removed Worktree",
        path: "/fake/path",
        branch: "rudu/feature",
        status: "removed",
        repoRoot: "/repo",
        isRuduManaged: true,
        removedAt: Date.now() - 10000,
      });

      const result = reconcileWorktreesOnRestart("/repo", repository);

      expect(result.validWorktrees).toHaveLength(0);
      expect(result.missingWorktrees).toHaveLength(0);
      expect(result.recoveredWorktreeIds).toHaveLength(0);
    });

    it("includes valid active worktrees in results", () => {
      // Create a temp directory that exists
      const fs = require("fs");
      const os = require("os");
      const path = require("path");
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rudu-reconcile-test-"));

      // Initialize a git repo and create a real worktree
      const { execSync } = require("child_process");
      execSync("git init", { cwd: tmpDir });
      execSync("git config user.email 'test@test.com'", { cwd: tmpDir });
      execSync("git config user.name 'Test'", { cwd: tmpDir });

      // Create initial commit on main
      const testFile = path.join(tmpDir, "test.txt");
      fs.writeFileSync(testFile, "test content");
      execSync("git add .", { cwd: tmpDir });
      execSync("git commit -m 'initial'", { cwd: tmpDir });

      try {
        execSync("git branch -m main", { cwd: tmpDir });
      } catch {
        // Might already be main
      }

      // Create a linked worktree as a subdirectory (to avoid path resolution issues)
      const worktreePath = path.join(tmpDir, "rudu-test-worktree");
      try {
        execSync(`git worktree add -b rudu/test-branch "${worktreePath}"`, { cwd: tmpDir });
      } catch {
        // Worktree might already exist
      }

      // Use realpath to resolve any symlinks (macOS /tmp vs /private/tmp issue)
      const realTmpDir = fs.realpathSync(tmpDir);
      const realWorktreePath = fs.realpathSync(worktreePath);

      // Insert the worktree into repository
      repository.insertWorktree({
        id: "wt-valid",
        title: "Valid Worktree",
        path: realWorktreePath,
        branch: "rudu/test-branch",
        status: "active",
        repoRoot: realTmpDir,
        isRuduManaged: true,
      });

      const result = reconcileWorktreesOnRestart(realTmpDir, repository);

      expect(result.validWorktrees).toHaveLength(1);
      expect(result.validWorktrees[0]!.id).toBe("wt-valid");
      expect(result.missingWorktrees).toHaveLength(0);

      // Cleanup
      try {
        fs.rmSync(worktreePath, { recursive: true, force: true });
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it("handles mixed valid and missing worktrees", () => {
      const fs = require("fs");
      const os = require("os");
      const path = require("path");
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rudu-reconcile-mixed-"));

      // Initialize a git repo
      const { execSync } = require("child_process");
      execSync("git init", { cwd: tmpDir });
      execSync("git config user.email 'test@test.com'", { cwd: tmpDir });
      execSync("git config user.name 'Test'", { cwd: tmpDir });

      // Create initial commit
      const testFile = path.join(tmpDir, "test.txt");
      fs.writeFileSync(testFile, "test content");
      execSync("git add .", { cwd: tmpDir });
      execSync("git commit -m 'initial'", { cwd: tmpDir });

      try {
        execSync("git branch -m main", { cwd: tmpDir });
      } catch {
        // Might already be main
      }

      // Create a linked worktree (valid one) as subdirectory
      const validWorktreePath = path.join(tmpDir, "rudu-valid-worktree");
      try {
        execSync(`git worktree add -b rudu/valid-branch "${validWorktreePath}"`, { cwd: tmpDir });
      } catch {
        // Worktree might already exist
      }

      // Use realpath to resolve symlinks (macOS /tmp vs /private/tmp issue)
      const realTmpDir = fs.realpathSync(tmpDir);
      const realWorktreePath = fs.realpathSync(validWorktreePath);

      // Insert valid worktree
      repository.insertWorktree({
        id: "wt-valid-mixed",
        title: "Valid Worktree",
        path: realWorktreePath,
        branch: "rudu/valid-branch",
        status: "active",
        repoRoot: realTmpDir,
        isRuduManaged: true,
      });

      // Insert missing worktree (path doesn't exist)
      repository.insertWorktree({
        id: "wt-missing-mixed",
        title: "Missing Worktree",
        path: "/definitely/fake/path",
        branch: "rudu/missing",
        status: "active",
        repoRoot: realTmpDir,
        isRuduManaged: true,
      });

      // Insert archived worktree with missing path (should be marked missing)
      repository.insertWorktree({
        id: "wt-archived-missing",
        title: "Archived Missing Worktree",
        path: "/another/fake/path",
        branch: "rudu/archived-missing",
        status: "archived",
        repoRoot: realTmpDir,
        isRuduManaged: true,
        archivedAt: Date.now() - 10000,
      });

      const result = reconcileWorktreesOnRestart(realTmpDir, repository);

      // Should have 1 valid worktree
      expect(result.validWorktrees).toHaveLength(1);
      expect(result.validWorktrees[0]!.id).toBe("wt-valid-mixed");

      // Should have 2 missing worktrees (active missing + archived missing)
      expect(result.missingWorktrees).toHaveLength(2);
      expect(result.missingWorktrees.map((m) => m.worktree.id).sort()).toEqual([
        "wt-archived-missing",
        "wt-missing-mixed",
      ]);

      // Verify both were marked as recovered
      expect(result.recoveredWorktreeIds).toContain("wt-missing-mixed");
      expect(result.recoveredWorktreeIds).toContain("wt-archived-missing");

      // Verify persistence updates
      const missingWorktree = repository.getWorktree("wt-missing-mixed");
      expect(missingWorktree?.status).toBe("cleanup_failed");
      expect(missingWorktree?.error).toBeDefined();

      const archivedMissing = repository.getWorktree("wt-archived-missing");
      expect(archivedMissing?.status).toBe("cleanup_failed");

      // Cleanup
      try {
        fs.rmSync(validWorktreePath, { recursive: true, force: true });
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });
  });

  describe("restart recovery end-to-end semantics", () => {
    let e2eRepository: InMemoryWorktreeRepository;

    beforeEach(() => {
      e2eRepository = new InMemoryWorktreeRepository();
    });

    it("missing worktrees are surfaced without recreation", () => {
      const fs = require("fs");
      const os = require("os");
      const path = require("path");
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rudu-no-recreate-"));

      // Insert a worktree record but don't create the actual git worktree
      e2eRepository.insertWorktree({
        id: "wt-no-recreate",
        title: "Should Not Be Recreated",
        path: path.join(tmpDir, "nonexistent-worktree"),
        branch: "rudu/feature",
        status: "active",
        repoRoot: tmpDir,
        isRuduManaged: true,
      });

      // Initialize a git repo (but don't create the worktree)
      const { execSync } = require("child_process");
      execSync("git init", { cwd: tmpDir });
      execSync("git config user.email 'test@test.com'", { cwd: tmpDir });
      execSync("git config user.name 'Test'", { cwd: tmpDir });

      // Create initial commit
      const testFile = path.join(tmpDir, "test.txt");
      fs.writeFileSync(testFile, "test content");
      execSync("git add .", { cwd: tmpDir });
      execSync("git commit -m 'initial'", { cwd: tmpDir });

      const result = reconcileWorktreesOnRestart(tmpDir, e2eRepository);

      // Worktree should be marked as missing, NOT recreated
      expect(result.missingWorktrees).toHaveLength(1);
      expect(result.validWorktrees).toHaveLength(0);

      // Verify the worktree was not recreated (path still doesn't exist)
      expect(fs.existsSync(path.join(tmpDir, "nonexistent-worktree"))).toBe(false);

      // Verify it's in cleanup_failed state
      const worktree = e2eRepository.getWorktree("wt-no-recreate");
      expect(worktree?.status).toBe("cleanup_failed");

      // Cleanup
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it("excludes cleanup_failed worktrees from valid list on subsequent restarts", () => {
      const fs = require("fs");
      const os = require("os");
      const path = require("path");
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rudu-subsequent-"));

      // Insert a worktree already in cleanup_failed state
      e2eRepository.insertWorktree({
        id: "wt-already-failed",
        title: "Already Failed Worktree",
        path: path.join(tmpDir, "missing-path"),
        branch: "rudu/feature",
        status: "cleanup_failed",
        repoRoot: tmpDir,
        isRuduManaged: true,
        error: "Previously failed during cleanup",
      });

      // Initialize a git repo
      const { execSync } = require("child_process");
      execSync("git init", { cwd: tmpDir });
      execSync("git config user.email 'test@test.com'", { cwd: tmpDir });
      execSync("git config user.name 'Test'", { cwd: tmpDir });

      const testFile = path.join(tmpDir, "test.txt");
      fs.writeFileSync(testFile, "test content");
      execSync("git add .", { cwd: tmpDir });
      execSync("git commit -m 'initial'", { cwd: tmpDir });

      const result = reconcileWorktreesOnRestart(tmpDir, e2eRepository);

      // Already failed worktree should not appear in valid list
      expect(result.validWorktrees).toHaveLength(0);
      // And should be marked as missing again
      expect(result.missingWorktrees).toHaveLength(1);

      // Cleanup
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });
  });
});
