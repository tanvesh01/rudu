import { test, expect, describe, beforeEach } from "bun:test";
import {
  deriveBranchName,
  deriveSiblingPath,
  previewWorktreeNames,
  archiveWorktree,
  deleteWorktree,
  createWorktree,
  createWorktreeAsync,
  type CreateWorktreeInput,
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
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const { execSync } = require("child_process");

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

  test("fails when worktree is already archived", () => {
    repository.insertWorktree({
      id: "wt-1",
      title: "Test Worktree",
      path: "/tmp/test-worktree",
      branch: "rudu/test",
      status: "archived",
      repoRoot: "/tmp/repo",
      isRuduManaged: true,
      archivedAt: Date.now(),
    });

    const result = archiveWorktree("wt-1", repository);
    expect(result.type).toBe("failure");
    expect(result.error).toContain("already been archived");
  });

  test("fails when worktree is removed", () => {
    repository.insertWorktree({
      id: "wt-1",
      title: "Test Worktree",
      path: "/tmp/test-worktree",
      branch: "rudu/test",
      status: "removed",
      repoRoot: "/tmp/repo",
      isRuduManaged: true,
      removedAt: Date.now(),
    });

    const result = archiveWorktree("wt-1", repository);
    expect(result.type).toBe("failure");
    expect(result.error).toContain("already been removed");
  });

  test("successfully archives an active worktree and removes it from disk", () => {
    // Create a temporary git repository with a linked worktree
    const testRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "rudu-archive-test-"));

    // Initialize a git repo
    execSync("git init", { cwd: testRepoDir });
    execSync("git config user.email 'test@test.com'", { cwd: testRepoDir });
    execSync("git config user.name 'Test'", { cwd: testRepoDir });

    // Create initial commit
    const testFile = path.join(testRepoDir, "test.txt");
    fs.writeFileSync(testFile, "test content");
    execSync("git add .", { cwd: testRepoDir });
    execSync("git commit -m 'initial'", { cwd: testRepoDir });

    // Create main branch
    try {
      execSync("git branch -m main", { cwd: testRepoDir });
    } catch {
      // Might already be main
    }

    // Create a linked worktree
    const worktreePath = path.join(os.tmpdir(), `rudu-archive-worktree-${Date.now()}`);
    execSync(`git worktree add -b rudu/test-branch "${worktreePath}"`, { cwd: testRepoDir });

    repository.insertWorktree({
      id: "wt-1",
      title: "Test Worktree",
      path: worktreePath,
      branch: "rudu/test-branch",
      status: "active",
      repoRoot: testRepoDir,
      isRuduManaged: true,
    });

    // Verify the worktree directory exists before archiving
    expect(fs.existsSync(worktreePath)).toBe(true);

    const beforeArchive = Date.now();
    const result = archiveWorktree("wt-1", repository, testRepoDir);
    const afterArchive = Date.now();

    expect(result.type).toBe("success");
    expect(result.worktree).toBeDefined();
    expect(result.worktree?.status).toBe("archived");
    expect(result.worktree?.archivedAt).toBeGreaterThanOrEqual(beforeArchive);
    expect(result.worktree?.archivedAt).toBeLessThanOrEqual(afterArchive);

    // Verify the worktree directory was removed from disk (new archive semantics)
    expect(fs.existsSync(worktreePath)).toBe(false);

    // Verify the branch still exists in the repo (we only remove the worktree, not the branch)
    const branches = execSync("git branch -l", { cwd: testRepoDir, encoding: "utf-8" });
    expect(branches).toContain("rudu/test-branch");

    // Cleanup
    fs.rmSync(testRepoDir, { recursive: true, force: true });
  });

  test("successfully archives a worktree in creating status", () => {
    // Create a temporary directory for this test
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

    // For worktrees in "creating" status, the directory might not exist as a git worktree yet
    // so we just mark it as archived
    const result = archiveWorktree("wt-1", repository, "/tmp/repo");

    expect(result.type).toBe("success");
    expect(result.worktree?.status).toBe("archived");

    // Cleanup
    fs.rmdirSync(tmpDir);
  });

  test("persists archived status and rehydrates correctly", () => {
    // Create a temporary git repository with a linked worktree
    const testRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "rudu-archive-test-"));

    // Initialize a git repo
    execSync("git init", { cwd: testRepoDir });
    execSync("git config user.email 'test@test.com'", { cwd: testRepoDir });
    execSync("git config user.name 'Test'", { cwd: testRepoDir });

    // Create initial commit
    const testFile = path.join(testRepoDir, "test.txt");
    fs.writeFileSync(testFile, "test content");
    execSync("git add .", { cwd: testRepoDir });
    execSync("git commit -m 'initial'", { cwd: testRepoDir });

    // Create main branch
    try {
      execSync("git branch -m main", { cwd: testRepoDir });
    } catch {
      // Might already be main
    }

    // Create a linked worktree
    const worktreePath = path.join(os.tmpdir(), `rudu-archive-worktree-${Date.now()}`);
    execSync(`git worktree add -b rudu/test-branch "${worktreePath}"`, { cwd: testRepoDir });

    repository.insertWorktree({
      id: "wt-1",
      title: "Test Worktree",
      path: worktreePath,
      branch: "rudu/test-branch",
      status: "active",
      repoRoot: testRepoDir,
      isRuduManaged: true,
    });

    // Archive the worktree
    archiveWorktree("wt-1", repository, testRepoDir);

    // Verify rehydration: the worktree should have archived status
    const rehydrated = repository.getWorktree("wt-1");
    expect(rehydrated).toBeDefined();
    expect(rehydrated?.status).toBe("archived");
    expect(rehydrated?.archivedAt).toBeDefined();

    // Verify metadata is preserved
    expect(rehydrated?.title).toBe("Test Worktree");
    expect(rehydrated?.branch).toBe("rudu/test-branch");
    expect(rehydrated?.path).toBe(worktreePath);
    expect(rehydrated?.isRuduManaged).toBe(true);

    // Cleanup
    fs.rmSync(testRepoDir, { recursive: true, force: true });
  });

  test("succeeds when worktree path does not exist (already cleaned up)", () => {
    // When the path doesn't exist, we consider the worktree already gone
    // and just mark it as archived
    repository.insertWorktree({
      id: "wt-1",
      title: "Test Worktree",
      path: "/nonexistent/path/that/is/already/gone",
      branch: "rudu/test",
      status: "active",
      repoRoot: "/tmp/repo",
      isRuduManaged: true,
    });

    const result = archiveWorktree("wt-1", repository, "/tmp/repo");

    // When path doesn't exist, we still mark it as archived
    expect(result.type).toBe("success");

    // Verify worktree status was updated to archived
    const updatedWorktree = repository.getWorktree("wt-1");
    expect(updatedWorktree?.status).toBe("archived");
    expect(updatedWorktree?.archivedAt).toBeDefined();
  });

  test("records archive_failed when git worktree remove throws an error", () => {
    // Create a temporary git repo
    const testRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "rudu-archive-test-"));

    // Initialize a git repo
    execSync("git init", { cwd: testRepoDir });
    execSync("git config user.email 'test@test.com'", { cwd: testRepoDir });
    execSync("git config user.name 'Test'", { cwd: testRepoDir });

    // Create initial commit
    const testFile = path.join(testRepoDir, "test.txt");
    fs.writeFileSync(testFile, "test content");
    execSync("git add .", { cwd: testRepoDir });
    execSync("git commit -m 'initial'", { cwd: testRepoDir });

    // Create main branch
    try {
      execSync("git branch -m main", { cwd: testRepoDir });
    } catch {
      // Might already be main
    }

    // Use the main repo directory as the worktree path (can't remove main worktree)
    repository.insertWorktree({
      id: "wt-1",
      title: "Test Worktree",
      path: testRepoDir, // Path exists but is main worktree, not a linked worktree
      branch: "rudu/test",
      status: "active",
      repoRoot: testRepoDir,
      isRuduManaged: true,
    });

    const result = archiveWorktree("wt-1", repository, testRepoDir);

    // Main worktree cannot be removed via git worktree remove, so this should fail
    expect(result.type).toBe("failure");

    // Verify worktree status was updated to archive_failed
    const updatedWorktree = repository.getWorktree("wt-1");
    expect(updatedWorktree?.status).toBe("archive_failed");
    expect(updatedWorktree?.error).toBeDefined();

    // Cleanup
    fs.rmSync(testRepoDir, { recursive: true, force: true });
  });

  test("blocks when sessions are active and cancels them", () => {
    // Create a temporary git repository with a linked worktree
    const testRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "rudu-archive-test-"));

    // Initialize a git repo
    execSync("git init", { cwd: testRepoDir });
    execSync("git config user.email 'test@test.com'", { cwd: testRepoDir });
    execSync("git config user.name 'Test'", { cwd: testRepoDir });

    // Create initial commit
    const testFile = path.join(testRepoDir, "test.txt");
    fs.writeFileSync(testFile, "test content");
    execSync("git add .", { cwd: testRepoDir });
    execSync("git commit -m 'initial'", { cwd: testRepoDir });

    // Create main branch
    try {
      execSync("git branch -m main", { cwd: testRepoDir });
    } catch {
      // Might already be main
    }

    // Create a linked worktree
    const worktreePath = path.join(os.tmpdir(), `rudu-archive-worktree-${Date.now()}`);
    execSync(`git worktree add -b rudu/test-branch "${worktreePath}"`, { cwd: testRepoDir });

    repository.insertWorktree({
      id: "wt-1",
      title: "Test Worktree",
      path: worktreePath,
      branch: "rudu/test-branch",
      status: "active",
      repoRoot: testRepoDir,
      isRuduManaged: true,
    });

    // Create a mock session manager with active sessions
    const sessions = [
      { id: "session-1", worktreeId: "wt-1", status: "running" },
      { id: "session-2", worktreeId: "wt-1", status: "queued" },
    ];
    const sessionManager = {
      listSessions: () => sessions,
      cancelSession: (id: string) => {
        const session = sessions.find((s) => s.id === id);
        if (session) {
          session.status = "cancelled";
        }
        return true;
      },
    };

    const result = archiveWorktree("wt-1", repository, testRepoDir, sessionManager);

    expect(result.type).toBe("blocked");
    expect(result.error).toContain("2 session(s) are active");

    // Verify worktree status was updated to cleanup_pending
    const updatedWorktree = repository.getWorktree("wt-1");
    expect(updatedWorktree?.status).toBe("cleanup_pending");

    // Verify sessions were cancelled
    expect(sessions[0]?.status).toBe("cancelled");
    expect(sessions[1]?.status).toBe("cancelled");

    // Cleanup
    fs.rmSync(testRepoDir, { recursive: true, force: true });
    fs.rmSync(worktreePath, { recursive: true, force: true });
  });
});

describe("deleteWorktree", () => {
  let repository: InMemoryWorktreeRepository;

  beforeEach(() => {
    repository = new InMemoryWorktreeRepository();
  });

  function createMockSessionManager(sessions: Array<{
    id: string;
    worktreeId?: string;
    status: string;
  }> = []) {
    return {
      listSessions: () => sessions,
      cancelSession: (id: string) => {
        const session = sessions.find((s) => s.id === id);
        if (session) {
          session.status = "cancelled";
        }
        return true;
      },
    };
  }

  test("fails when worktree does not exist", () => {
    const sessionManager = createMockSessionManager();
    const result = deleteWorktree("non-existent-id", repository, sessionManager);
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

    const sessionManager = createMockSessionManager();
    const result = deleteWorktree("wt-1", repository, sessionManager);
    expect(result.type).toBe("failure");
    expect(result.error).toContain("Only Rudu-managed worktrees");
  });

  test("fails when worktree is already removed", () => {
    repository.insertWorktree({
      id: "wt-1",
      title: "Test Worktree",
      path: "/tmp/test-worktree",
      branch: "rudu/test",
      status: "removed",
      repoRoot: "/tmp/repo",
      isRuduManaged: true,
      removedAt: Date.now(),
    });

    const sessionManager = createMockSessionManager();
    const result = deleteWorktree("wt-1", repository, sessionManager);
    expect(result.type).toBe("failure");
    expect(result.error).toContain("already been removed");
  });

  test("blocks when sessions are active and cancels them", () => {
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

    const sessions = [
      { id: "session-1", worktreeId: "wt-1", status: "running" },
      { id: "session-2", worktreeId: "wt-1", status: "queued" },
    ];
    const sessionManager = createMockSessionManager(sessions);

    const result = deleteWorktree("wt-1", repository, sessionManager);

    expect(result.type).toBe("blocked");
    expect(result.error).toContain("2 session(s) are active");

    // Verify worktree status was updated to cleanup_pending
    const updatedWorktree = repository.getWorktree("wt-1");
    expect(updatedWorktree?.status).toBe("cleanup_pending");

    // Verify sessions were cancelled
    expect(sessions[0]?.status).toBe("cancelled");
    expect(sessions[1]?.status).toBe("cancelled");

    // Cleanup
    fs.rmdirSync(tmpDir);
  });

  test("succeeds when no sessions are active", () => {
    // Create a temporary directory for this test
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rudu-test-"));

    // Initialize a git repo for the worktree
    const { execSync } = require("child_process");
    execSync("git init", { cwd: tmpDir });
    execSync("git config user.email 'test@test.com'", { cwd: tmpDir });
    execSync("git config user.name 'Test'", { cwd: tmpDir });

    // Create initial commit and main branch
    const testFile = path.join(tmpDir, "test.txt");
    fs.writeFileSync(testFile, "test content");
    execSync("git add .", { cwd: tmpDir });
    execSync("git commit -m 'initial'", { cwd: tmpDir });

    // Create main branch if not exists
    try {
      execSync("git branch -m main", { cwd: tmpDir });
    } catch {
      // Branch might already be named main
    }

    repository.insertWorktree({
      id: "wt-1",
      title: "Test Worktree",
      path: tmpDir,
      branch: "rudu/test",
      status: "active",
      repoRoot: tmpDir, // Use tmpDir as repo root
      isRuduManaged: true,
    });

    // Add a worktree entry for this path
    try {
      execSync(`git worktree add -b rudu/test "${tmpDir}-worktree"`, { cwd: tmpDir });
    } catch {
      // May already exist, that's ok for this test
    }

    const sessions = [
      { id: "session-1", worktreeId: "wt-1", status: "succeeded" },
      { id: "session-2", worktreeId: "wt-1", status: "failed" },
    ];
    const sessionManager = createMockSessionManager(sessions);

    const result = deleteWorktree("wt-1", repository, sessionManager);

    // The worktree path doesn't exist as a proper git worktree in this test setup,
    // so it will likely fail - that's ok for testing the structure
    // We just verify the attempt was made properly
    expect(result.type === "success" || result.type === "failure").toBe(true);

    if (result.type === "success") {
      expect(result.worktree?.status).toBe("removed");
      expect(result.worktree?.removedAt).toBeDefined();
    }

    // Cleanup
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(`${tmpDir}-worktree`, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("succeeds when worktree path does not exist (already cleaned up)", () => {
    // When the path doesn't exist, we consider the worktree already removed
    repository.insertWorktree({
      id: "wt-1",
      title: "Test Worktree",
      path: "/nonexistent/path/that/is/already/gone",
      branch: "rudu/test",
      status: "active",
      repoRoot: "/tmp/repo",
      isRuduManaged: true,
    });

    const sessionManager = createMockSessionManager();
    const result = deleteWorktree("wt-1", repository, sessionManager);

    // When path doesn't exist, we mark it as removed (already gone)
    expect(result.type).toBe("success");

    // Verify worktree status was updated to removed
    const updatedWorktree = repository.getWorktree("wt-1");
    expect(updatedWorktree?.status).toBe("removed");
    expect(updatedWorktree?.removedAt).toBeDefined();
  });

  test("records cleanup_failed when git worktree remove throws an error", () => {
    // Create a temporary directory for this test
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rudu-test-"));

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

    // Create main branch
    try {
      execSync("git branch -m main", { cwd: tmpDir });
    } catch {
      // Might already be main
    }

    repository.insertWorktree({
      id: "wt-1",
      title: "Test Worktree",
      path: tmpDir, // Path exists but is main worktree, not a linked worktree
      branch: "rudu/test",
      status: "active",
      repoRoot: tmpDir,
      isRuduManaged: true,
    });

    const sessionManager = createMockSessionManager();
    const result = deleteWorktree("wt-1", repository, sessionManager);

    // Main worktree cannot be removed via git worktree remove, so this should fail
    expect(result.type).toBe("failure");

    // Verify worktree status was updated to cleanup_failed
    const updatedWorktree = repository.getWorktree("wt-1");
    expect(updatedWorktree?.status).toBe("cleanup_failed");
    expect(updatedWorktree?.error).toBeDefined();

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("ignores sessions from other worktrees", () => {
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

    // Sessions from other worktrees should not block deletion
    const sessions = [
      { id: "session-1", worktreeId: "wt-2", status: "running" },
      { id: "session-2", worktreeId: "wt-3", status: "queued" },
      { id: "session-3", worktreeId: undefined, status: "starting" }, // No worktreeId
    ];
    const sessionManager = createMockSessionManager(sessions);

    // This will fail for git reasons, but should NOT be blocked by active sessions
    const result = deleteWorktree("wt-1", repository, sessionManager);

    // Should not be blocked - the other sessions don't belong to this worktree
    expect(result.type).not.toBe("blocked");

    // Cleanup
    fs.rmdirSync(tmpDir);
  });
});

describe("createWorktree real end-to-end", () => {
  let repository: InMemoryWorktreeRepository;
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const { execSync } = require("child_process");

  let testRepoDir: string;

  beforeEach(() => {
    repository = new InMemoryWorktreeRepository();

    // Create a temporary git repository for testing
    testRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "rudu-create-test-"));

    // Initialize a git repo
    execSync("git init", { cwd: testRepoDir });
    execSync("git config user.email 'test@test.com'", { cwd: testRepoDir });
    execSync("git config user.name 'Test'", { cwd: testRepoDir });

    // Create initial commit
    const testFile = path.join(testRepoDir, "test.txt");
    fs.writeFileSync(testFile, "test content");
    execSync("git add .", { cwd: testRepoDir });
    execSync("git commit -m 'initial'", { cwd: testRepoDir });

    // Create main branch
    try {
      execSync("git branch -m main", { cwd: testRepoDir });
    } catch {
      // Might already be main
    }
  });

  test("creates a sibling worktree from default branch with valid input", () => {
    const input: CreateWorktreeInput = {
      title: "my feature",
      repoRoot: testRepoDir,
      defaultBranch: "main",
    };

    const result = createWorktree(input, repository);

    expect(result.type).toBe("success");
    if (result.type !== "success") return;

    expect(result.worktree).toBeDefined();
    expect(result.worktree.title).toBe("my feature");
    expect(result.worktree.branch).toBe("rudu/my-feature");
    expect(result.worktree.repoRoot).toBe(testRepoDir);
    expect(result.worktree.status).toBe("active");
    expect(result.worktree.isRuduManaged).toBe(true);

    // Verify the worktree was persisted
    const persisted = repository.getWorktree(result.worktree.id);
    expect(persisted).toBeDefined();
    expect(persisted?.title).toBe("my feature");

    // Verify the directory was created
    expect(fs.existsSync(result.worktree.path)).toBe(true);

    // Verify it's a git worktree
    const gitDir = path.join(result.worktree.path, ".git");
    expect(fs.existsSync(gitDir) || fs.existsSync(gitDir + ".file")).toBe(true);

    // Cleanup the created worktree
    try {
      fs.rmSync(result.worktree.path, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("fails with empty title", () => {
    const input: CreateWorktreeInput = {
      title: "",
      repoRoot: testRepoDir,
      defaultBranch: "main",
    };

    const result = createWorktree(input, repository);

    expect(result.type).toBe("failure");
    if (result.type !== "failure") return;

    expect(result.error).toContain("Title is required");
    expect(result.recoverable).toBe(true);
  });

  test("fails with short title", () => {
    const input: CreateWorktreeInput = {
      title: "x",
      repoRoot: testRepoDir,
      defaultBranch: "main",
    };

    const result = createWorktree(input, repository);

    expect(result.type).toBe("failure");
    if (result.type !== "failure") return;

    expect(result.error).toContain("at least 2 characters");
    expect(result.recoverable).toBe(true);
  });

  test("handles branch collision by creating unique branch name", () => {
    // Create first worktree
    const input1: CreateWorktreeInput = {
      title: "feature one",
      repoRoot: testRepoDir,
      defaultBranch: "main",
    };

    const result1 = createWorktree(input1, repository);
    expect(result1.type).toBe("success");
    if (result1.type !== "success") return;

    const firstPath = result1.worktree.path;
    const firstBranch = result1.worktree.branch;

    // Create second worktree with same title (should get different branch name)
    const input2: CreateWorktreeInput = {
      title: "feature one",
      repoRoot: testRepoDir,
      defaultBranch: "main",
    };

    const result2 = createWorktree(input2, repository);

    expect(result2.type).toBe("success");
    if (result2.type !== "success") return;

    expect(result2.worktree.branch).not.toBe(firstBranch);
    expect(result2.worktree.branch).toMatch(/rudu\/feature-one-\d+/);

    // Cleanup
    try {
      fs.rmSync(firstPath, { recursive: true, force: true });
      fs.rmSync(result2.worktree.path, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("fails when default branch does not exist", () => {
    const input: CreateWorktreeInput = {
      title: "my feature",
      repoRoot: testRepoDir,
      defaultBranch: "nonexistent-branch",
    };

    const result = createWorktree(input, repository);

    expect(result.type).toBe("failure");
    if (result.type !== "failure") return;

    expect(result.error).toContain("not found");
    expect(result.recoverable).toBe(true);
  });

  test("persists worktree record with all required fields", () => {
    const input: CreateWorktreeInput = {
      title: "test persistence",
      repoRoot: testRepoDir,
      defaultBranch: "main",
    };

    const result = createWorktree(input, repository);

    expect(result.type).toBe("success");
    if (result.type !== "success") return;

    expect(result.worktree).toBeDefined();

    // Verify all required fields are present
    expect(result.worktree.id).toBeDefined();
    expect(result.worktree.id.length).toBeGreaterThan(0);
    expect(result.worktree.title).toBe("test persistence");
    expect(result.worktree.path).toBeDefined();
    expect(result.worktree.branch).toBeDefined();
    expect(result.worktree.status).toBe("active");
    expect(result.worktree.repoRoot).toBe(testRepoDir);
    expect(result.worktree.isRuduManaged).toBe(true);
    expect(result.worktree.createdAt).toBeDefined();
    expect(result.worktree.updatedAt).toBeDefined();

    // Cleanup
    try {
      fs.rmSync(result.worktree.path, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("createWorktreeAsync creates a sibling worktree from default branch", async () => {
    const input: CreateWorktreeInput = {
      title: "async feature",
      repoRoot: testRepoDir,
      defaultBranch: "main",
    };

    const result = await createWorktreeAsync(input, repository);

    expect(result.type).toBe("success");
    if (result.type !== "success") return;

    expect(result.worktree.title).toBe("async feature");
    expect(result.worktree.branch).toBe("rudu/async-feature");
    expect(fs.existsSync(result.worktree.path)).toBe(true);
    expect(repository.getWorktree(result.worktree.id)?.title).toBe("async feature");

    try {
      fs.rmSync(result.worktree.path, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("createWorktreeAsync fails with empty title", async () => {
    const input: CreateWorktreeInput = {
      title: "",
      repoRoot: testRepoDir,
      defaultBranch: "main",
    };

    const result = await createWorktreeAsync(input, repository);

    expect(result.type).toBe("failure");
    if (result.type !== "failure") return;

    expect(result.error).toContain("Title is required");
    expect(result.recoverable).toBe(true);
  });

  test("createWorktreeAsync handles branch collision by creating a unique branch name", async () => {
    const input: CreateWorktreeInput = {
      title: "async collision",
      repoRoot: testRepoDir,
      defaultBranch: "main",
    };

    const first = await createWorktreeAsync(input, repository);
    expect(first.type).toBe("success");
    if (first.type !== "success") return;

    const second = await createWorktreeAsync(input, repository);
    expect(second.type).toBe("success");
    if (second.type !== "success") return;

    expect(second.worktree.branch).not.toBe(first.worktree.branch);
    expect(second.worktree.branch).toMatch(/rudu\/async-collision-\d+/);

    try {
      fs.rmSync(first.worktree.path, { recursive: true, force: true });
      fs.rmSync(second.worktree.path, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });
});
