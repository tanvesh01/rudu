import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execSync } from "child_process";
import {
  detectRepoContext,
  isSupportedRepo,
  resolveGitDir,
} from "./RepoContext.js";

// Helper to normalize paths for comparison (handles macOS /var -> /private/var symlinks)
function realPath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

describe("RepoContext", () => {
  describe("detectRepoContext", () => {
    let tempDirs: string[] = [];

    afterAll(() => {
      // Cleanup: bun test runs in isolated processes, so temp dirs will be cleaned by OS eventually
      // but we try to remove them explicitly
      for (const dir of tempDirs) {
        try {
          execSync(`rm -rf "${dir}"`, { timeout: 5000 });
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    function createTempDir(): string {
      const dir = mkdtempSync(join(tmpdir(), "rudu-test-"));
      tempDirs.push(dir);
      return dir;
    }

    function initGitRepo(dir: string, defaultBranch: string = "main"): void {
      execSync("git init", { cwd: dir });
      execSync(`git checkout -b ${defaultBranch}`, { cwd: dir });
      // Configure git user for commits
      execSync('git config user.email "test@test.com"', { cwd: dir });
      execSync('git config user.name "Test User"', { cwd: dir });
      // Create initial commit to establish the branch
      writeFileSync(join(dir, "README.md"), "# Test");
      execSync("git add README.md", { cwd: dir });
      execSync('git commit -m "Initial commit"', { cwd: dir });
    }

    it("returns unsupported when not in a git repository", () => {
      const tempDir = createTempDir();
      const result = detectRepoContext(tempDir);

      expect(result.type).toBe("unsupported");
      expect(result.type === "unsupported" && result.reason).toContain(
        "Not a git repository",
      );
    });

    it("resolves canonical repo from repo root", () => {
      const tempDir = createTempDir();
      initGitRepo(tempDir, "main");

      const result = detectRepoContext(tempDir);

      expect(result.type).toBe("supported");
      if (result.type === "supported") {
        expect(realPath(result.repoRoot)).toBe(realPath(tempDir));
        expect(result.defaultBranch).toBe("main");
      }
    });

    it("resolves same canonical repo from nested subdirectory", () => {
      const tempDir = createTempDir();
      initGitRepo(tempDir, "main");

      // Create nested directory structure
      const nestedDir = join(tempDir, "src", "components", "deep");
      mkdirSync(nestedDir, { recursive: true });

      const result = detectRepoContext(nestedDir);

      expect(result.type).toBe("supported");
      if (result.type === "supported") {
        expect(realPath(result.repoRoot)).toBe(realPath(tempDir));
        expect(result.defaultBranch).toBe("main");
      }
    });

    it("resolves same canonical repo from linked sibling worktree", () => {
      const mainRepo = createTempDir();
      initGitRepo(mainRepo, "main");

      // Create worktree as sibling to main repo
      const worktreeDir = createTempDir();
      execSync(`git worktree add "${worktreeDir}" -b feature-branch`, {
        cwd: mainRepo,
      });
      tempDirs.push(worktreeDir);

      const result = detectRepoContext(worktreeDir);

      expect(result.type).toBe("supported");
      if (result.type === "supported") {
        // git rev-parse --show-toplevel from a worktree returns the worktree path itself
        expect(realPath(result.repoRoot)).toBe(realPath(worktreeDir));
        expect(result.defaultBranch).toBe("main");
      }
    });

    it("resolves same default branch from repo root and linked worktree", () => {
      const mainRepo = createTempDir();
      initGitRepo(mainRepo, "main");

      // Create worktree as sibling
      const worktreeDir = createTempDir();
      execSync(`git worktree add "${worktreeDir}" -b feature-branch`, {
        cwd: mainRepo,
      });
      tempDirs.push(worktreeDir);

      // Both should resolve the same default branch
      const resultFromRepo = detectRepoContext(mainRepo);
      const resultFromWorktree = detectRepoContext(worktreeDir);

      expect(resultFromRepo.type).toBe("supported");
      expect(resultFromWorktree.type).toBe("supported");
      if (
        resultFromRepo.type === "supported" &&
        resultFromWorktree.type === "supported"
      ) {
        expect(resultFromRepo.defaultBranch).toBe(resultFromWorktree.defaultBranch);
      }
    });

    it("resolves default branch from origin/HEAD when available", () => {
      const tempDir = createTempDir();
      initGitRepo(tempDir, "develop");

      // Set up origin/HEAD to point to develop
      execSync("git remote add origin https://example.com/test.git", {
        cwd: tempDir,
      });
      // Create refs/remotes/origin/HEAD symref
      execSync("git update-ref refs/remotes/origin/develop HEAD", {
        cwd: tempDir,
      });
      // Set the symbolic ref
      try {
        execSync("git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/develop", {
          cwd: tempDir,
        });
      } catch {
        // If this fails, the fallback will still find "develop" branch locally
      }

      const result = detectRepoContext(tempDir);

      expect(result.type).toBe("supported");
      if (result.type === "supported") {
        expect(result.defaultBranch).toBe("develop");
      }
    });

    it("falls back to main branch when origin/HEAD unavailable", () => {
      const tempDir = createTempDir();
      initGitRepo(tempDir, "main");

      const result = detectRepoContext(tempDir);

      expect(result.type).toBe("supported");
      if (result.type === "supported") {
        expect(result.defaultBranch).toBe("main");
      }
    });

    it("falls back to master branch when main unavailable", () => {
      const tempDir = createTempDir();
      initGitRepo(tempDir, "master");

      const result = detectRepoContext(tempDir);

      expect(result.type).toBe("supported");
      if (result.type === "supported") {
        expect(result.defaultBranch).toBe("master");
      }
    });

    it("returns unsupported when no default branch can be determined", () => {
      const tempDir = createTempDir();
      initGitRepo(tempDir, "custom-branch");

      // Delete main/master branches, keep only custom
      // Since initGitRepo creates the custom-branch as the only branch,
      // and we don't have main or master, the fallback should fail
      const result = detectRepoContext(tempDir);

      // This might be supported if custom-branch is found, but let's verify behavior
      // when neither main nor master exists
      expect(result.type).toBe("unsupported");
      if (result.type === "unsupported") {
        expect(result.reason).toContain("default branch");
      }
    });

    it("uses process.cwd() when no startDir provided", () => {
      // Since we're running in a git repo (the rudu project itself)
      const result = detectRepoContext();

      // This should succeed since rudu is a git repo
      expect(result.type).toBe("supported");
      if (result.type === "supported") {
        expect(result.repoRoot).toBeDefined();
        expect(result.defaultBranch).toBeDefined();
      }
    });
  });

  describe("isSupportedRepo", () => {
    it("returns true for supported result", () => {
      const result = { type: "supported" as const, repoRoot: "/test", defaultBranch: "main" };
      expect(isSupportedRepo(result)).toBe(true);
    });

    it("returns false for unsupported result", () => {
      const result = { type: "unsupported" as const, reason: "test" };
      expect(isSupportedRepo(result)).toBe(false);
    });
  });

  describe("resolveGitDir", () => {
    let tempDirs: string[] = [];

    afterAll(() => {
      for (const dir of tempDirs) {
        try {
          execSync(`rm -rf "${dir}"`, { timeout: 5000 });
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    function createTempDir(): string {
      const dir = mkdtempSync(join(tmpdir(), "rudu-test-"));
      tempDirs.push(dir);
      return dir;
    }

    it("returns .git directory path for regular repo", () => {
      const tempDir = createTempDir();
      execSync("git init", { cwd: tempDir });

      const gitDir = resolveGitDir(tempDir);

      expect(gitDir).toBe(join(tempDir, ".git"));
    });

    it("returns null when .git does not exist", () => {
      const tempDir = createTempDir();

      const gitDir = resolveGitDir(tempDir);

      expect(gitDir).toBeNull();
    });

    it("resolves gitdir from .git file for linked worktrees", () => {
      const mainRepo = createTempDir();
      execSync("git init", { cwd: mainRepo });
      execSync('git config user.email "test@test.com"', { cwd: mainRepo });
      execSync('git config user.name "Test User"', { cwd: mainRepo });
      writeFileSync(join(mainRepo, "README.md"), "# Test");
      execSync("git add README.md", { cwd: mainRepo });
      execSync('git commit -m "Initial commit"', { cwd: mainRepo });

      const worktreeDir = createTempDir();
      execSync(`git worktree add "${worktreeDir}" -b feature-branch`, {
        cwd: mainRepo,
      });

      const gitDir = resolveGitDir(worktreeDir);

      expect(gitDir).not.toBeNull();
      // Should point to the worktree's gitdir within the main repo
      expect(gitDir).toContain(".git/worktrees/");
    });
  });
});
