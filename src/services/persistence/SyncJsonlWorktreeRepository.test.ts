import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  SyncJsonlWorktreeRepository,
  InMemoryWorktreeRepository,
} from "./SyncJsonlWorktreeRepository.js";
import type { NewPersistedWorktree } from "./worktree-schemas.js";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "rudu-worktree-test-"));
}

describe("SyncJsonlWorktreeRepository", () => {
  let tempDir: string;
  let repoRoot: string;

  beforeEach(() => {
    tempDir = createTempDir();
    repoRoot = tempDir;
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("insertWorktree", () => {
    it("inserts a new worktree with generated timestamps", () => {
      const repository = new SyncJsonlWorktreeRepository({
        dataDir: tempDir,
        projectRoot: repoRoot,
      });

      const worktree: NewPersistedWorktree = {
        id: "wt-123",
        title: "Feature Branch",
        path: "/path/to/worktree",
        branch: "feature-abc",
        status: "active",
        repoRoot: repoRoot,
        isRuduManaged: true,
      };

      repository.insertWorktree(worktree);

      const result = repository.getWorktree("wt-123");
      expect(result).toBeDefined();
      expect(result!.id).toBe("wt-123");
      expect(result!.title).toBe("Feature Branch");
      expect(result!.path).toBe("/path/to/worktree");
      expect(result!.branch).toBe("feature-abc");
      expect(result!.status).toBe("active");
      expect(result!.createdAt).toBeGreaterThan(0);
      expect(result!.updatedAt).toBeGreaterThan(0);
      expect(result!.schemaVersion).toBe(1);
    });

    it("persists worktree to JSONL file", () => {
      const repository = new SyncJsonlWorktreeRepository({
        dataDir: tempDir,
        projectRoot: repoRoot,
      });

      const worktree: NewPersistedWorktree = {
        id: "wt-456",
        title: "Test Worktree",
        path: "/test/path",
        branch: "test-branch",
        status: "active",
        repoRoot: repoRoot,
        isRuduManaged: true,
      };

      repository.insertWorktree(worktree);

      // Verify file was created
      const indexPath = join(tempDir, "worktrees.jsonl");
      expect(existsSync(indexPath)).toBe(true);
    });
  });

  describe("getWorktree", () => {
    it("returns undefined for unknown worktree", () => {
      const repository = new SyncJsonlWorktreeRepository({
        dataDir: tempDir,
        projectRoot: repoRoot,
      });

      const result = repository.getWorktree("unknown-id");
      expect(result).toBeUndefined();
    });

    it("returns the correct worktree by id", () => {
      const repository = new SyncJsonlWorktreeRepository({
        dataDir: tempDir,
        projectRoot: repoRoot,
      });

      repository.insertWorktree({
        id: "wt-1",
        title: "Worktree One",
        path: "/path/one",
        branch: "branch-one",
        status: "active",
        repoRoot: repoRoot,
        isRuduManaged: true,
      });

      repository.insertWorktree({
        id: "wt-2",
        title: "Worktree Two",
        path: "/path/two",
        branch: "branch-two",
        status: "creating",
        repoRoot: repoRoot,
        isRuduManaged: true,
      });

      const result = repository.getWorktree("wt-2");
      expect(result).toBeDefined();
      expect(result!.title).toBe("Worktree Two");
      expect(result!.status).toBe("creating");
    });
  });

  describe("listWorktrees", () => {
    it("returns empty array when no worktrees", () => {
      const repository = new SyncJsonlWorktreeRepository({
        dataDir: tempDir,
        projectRoot: repoRoot,
      });

      const result = repository.listWorktrees();
      expect(result).toEqual([]);
    });

    it("returns all worktrees sorted by createdAt", () => {
      const repository = new SyncJsonlWorktreeRepository({
        dataDir: tempDir,
        projectRoot: repoRoot,
      });

      repository.insertWorktree({
        id: "wt-b",
        title: "Worktree B",
        path: "/path/b",
        branch: "branch-b",
        status: "active",
        repoRoot: repoRoot,
        isRuduManaged: true,
      });

      repository.insertWorktree({
        id: "wt-a",
        title: "Worktree A",
        path: "/path/a",
        branch: "branch-a",
        status: "active",
        repoRoot: repoRoot,
        isRuduManaged: true,
      });

      const result = repository.listWorktrees();
      expect(result).toHaveLength(2);
      // Should be sorted by createdAt (ascending)
      expect(result[0]!.id).toBe("wt-b");
      expect(result[1]!.id).toBe("wt-a");
    });

    it("only includes worktrees for the current project", () => {
      const repoA = join(tempDir, "repoA");
      const repoB = join(tempDir, "repoB");

      const repositoryA = new SyncJsonlWorktreeRepository({
        dataDir: tempDir,
        projectRoot: repoA,
      });

      // Insert worktree for repoA
      repositoryA.insertWorktree({
        id: "wt-a",
        title: "Worktree A",
        path: "/path/a",
        branch: "branch-a",
        status: "active",
        repoRoot: repoA,
        isRuduManaged: true,
      });

      // Create new repository instance for repoB with same dataDir
      const repositoryB = new SyncJsonlWorktreeRepository({
        dataDir: tempDir,
        projectRoot: repoB,
      });

      // Insert worktree for repoB
      repositoryB.insertWorktree({
        id: "wt-b",
        title: "Worktree B",
        path: "/path/b",
        branch: "branch-b",
        status: "active",
        repoRoot: repoB,
        isRuduManaged: true,
      });

      const resultA = repositoryA.listWorktrees();
      const resultB = repositoryB.listWorktrees();

      // Each repo should only see its own worktree
      expect(resultA).toHaveLength(1);
      expect(resultA[0]!.id).toBe("wt-a");

      expect(resultB).toHaveLength(1);
      expect(resultB[0]!.id).toBe("wt-b");
    });
  });

  describe("listWorktreesForRepo", () => {
    it("filters worktrees by specific repo root", () => {
      const repository = new SyncJsonlWorktreeRepository({
        dataDir: tempDir,
        projectRoot: tempDir, // general project root
      });

      const repoA = join(tempDir, "repoA");
      const repoB = join(tempDir, "repoB");

      repository.insertWorktree({
        id: "wt-a1",
        title: "Worktree A1",
        path: "/path/a1",
        branch: "branch-a1",
        status: "active",
        repoRoot: repoA,
        isRuduManaged: true,
      });

      repository.insertWorktree({
        id: "wt-a2",
        title: "Worktree A2",
        path: "/path/a2",
        branch: "branch-a2",
        status: "active",
        repoRoot: repoA,
        isRuduManaged: true,
      });

      repository.insertWorktree({
        id: "wt-b",
        title: "Worktree B",
        path: "/path/b",
        branch: "branch-b",
        status: "active",
        repoRoot: repoB,
        isRuduManaged: true,
      });

      const resultA = repository.listWorktreesForRepo(repoA);
      const resultB = repository.listWorktreesForRepo(repoB);

      expect(resultA).toHaveLength(2);
      expect(resultA.map((w) => w.id).sort()).toEqual(["wt-a1", "wt-a2"]);

      expect(resultB).toHaveLength(1);
      expect(resultB[0]!.id).toBe("wt-b");
    });
  });

  describe("updateWorktree", () => {
    it("updates existing worktree fields", () => {
      const repository = new SyncJsonlWorktreeRepository({
        dataDir: tempDir,
        projectRoot: repoRoot,
      });

      repository.insertWorktree({
        id: "wt-1",
        title: "Original Title",
        path: "/path/original",
        branch: "original-branch",
        status: "creating",
        repoRoot: repoRoot,
        isRuduManaged: true,
      });

      const original = repository.getWorktree("wt-1")!;
      const originalUpdatedAt = original.updatedAt;

      // Wait a tiny bit to ensure timestamp changes
      const start = Date.now();
      while (Date.now() - start < 5) {
        // Busy wait for 5ms
      }

      repository.updateWorktree("wt-1", {
        title: "Updated Title",
        status: "active",
      });

      const updated = repository.getWorktree("wt-1")!;
      expect(updated.title).toBe("Updated Title");
      expect(updated.status).toBe("active");
      expect(updated.path).toBe("/path/original"); // Unchanged
      expect(updated.branch).toBe("original-branch"); // Unchanged
      expect(updated.updatedAt).toBeGreaterThan(originalUpdatedAt);
    });

    it("does nothing for unknown worktree", () => {
      const repository = new SyncJsonlWorktreeRepository({
        dataDir: tempDir,
        projectRoot: repoRoot,
      });

      // Should not throw
      repository.updateWorktree("unknown-id", {
        title: "New Title",
      });

      expect(repository.getWorktree("unknown-id")).toBeUndefined();
    });

    it("preserves immutable fields on update", () => {
      const repository = new SyncJsonlWorktreeRepository({
        dataDir: tempDir,
        projectRoot: repoRoot,
      });

      repository.insertWorktree({
        id: "wt-1",
        title: "Test Worktree",
        path: "/path/test",
        branch: "test-branch",
        status: "active",
        repoRoot: repoRoot,
        isRuduManaged: true,
      });

      const original = repository.getWorktree("wt-1")!;
      const originalCreatedAt = original.createdAt;
      const originalId = original.id;
      const originalSchemaVersion = original.schemaVersion;

      repository.updateWorktree("wt-1", {
        title: "New Title",
      });

      const updated = repository.getWorktree("wt-1")!;
      expect(updated.id).toBe(originalId);
      expect(updated.createdAt).toBe(originalCreatedAt);
      expect(updated.schemaVersion).toBe(originalSchemaVersion);
      expect(updated.projectRoot).toBe(original.projectRoot);
    });
  });

  describe("persistence", () => {
    // These tests verify that worktree data is persisted correctly.
    // Full cross-instance rehydration tests are more complex and rely on
    // filesystem timing - the core persistence is verified here.
    let persistenceDir: string;

    beforeEach(() => {
      persistenceDir = createTempDir();
    });

    afterEach(() => {
      try {
        rmSync(persistenceDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it("writes worktree records to JSONL file", () => {
      const sharedDir = persistenceDir;

      const repository = new SyncJsonlWorktreeRepository({
        dataDir: sharedDir,
        projectRoot: sharedDir,
      });

      repository.insertWorktree({
        id: "wt-persisted",
        title: "Persisted Worktree",
        path: "/path/persisted",
        branch: "persisted-branch",
        status: "active",
        repoRoot: sharedDir,
        isRuduManaged: true,
      });

      // Verify file was written
      const indexPath = join(sharedDir, "worktrees.jsonl");
      expect(existsSync(indexPath)).toBe(true);

      // Read and verify content
      const { readFileSync } = require("fs");
      const content = readFileSync(indexPath, "utf-8");
      const lines = content.trim().split("\n").filter((l: string) => l);
      expect(lines.length).toBeGreaterThan(0);

      // Parse and verify record
      const record = JSON.parse(lines[0]);
      expect(record.id).toBe("wt-persisted");
      expect(record.title).toBe("Persisted Worktree");
      expect(record.schemaVersion).toBe(1);
    });

    it("appends multiple updates to the JSONL file", () => {
      const sharedDir = persistenceDir;

      const repository = new SyncJsonlWorktreeRepository({
        dataDir: sharedDir,
        projectRoot: sharedDir,
      });

      repository.insertWorktree({
        id: "wt-versioned",
        title: "First Version",
        path: "/path/test",
        branch: "test-branch",
        status: "creating",
        repoRoot: sharedDir,
        isRuduManaged: true,
      });

      repository.updateWorktree("wt-versioned", { status: "active" });
      repository.updateWorktree("wt-versioned", { title: "Final Version" });

      // Read file and verify multiple records exist
      const indexPath = join(sharedDir, "worktrees.jsonl");
      const { readFileSync } = require("fs");
      const content = readFileSync(indexPath, "utf-8");
      const lines = content.trim().split("\n").filter((l: string) => l);

      // Should have 3 records (insert + 2 updates)
      expect(lines.length).toBe(3);

      // Last record should have final version
      const lastRecord = JSON.parse(lines[lines.length - 1]);
      expect(lastRecord.title).toBe("Final Version");
      expect(lastRecord.status).toBe("active");
    });
  });
});

describe("InMemoryWorktreeRepository", () => {
  describe("insertWorktree", () => {
    it("stores worktree in memory", () => {
      const repository = new InMemoryWorktreeRepository();

      repository.insertWorktree({
        id: "wt-mem",
        title: "Memory Worktree",
        path: "/path/memory",
        branch: "memory-branch",
        status: "active",
        repoRoot: "/repo",
        isRuduManaged: true,
      });

      const result = repository.getWorktree("wt-mem");
      expect(result).toBeDefined();
      expect(result!.title).toBe("Memory Worktree");
    });
  });

  describe("listWorktreesForRepo", () => {
    it("filters by repo root", () => {
      const repository = new InMemoryWorktreeRepository();

      repository.insertWorktree({
        id: "wt-1",
        title: "Worktree 1",
        path: "/path/1",
        branch: "branch-1",
        status: "active",
        repoRoot: "/repo/a",
        isRuduManaged: true,
      });

      repository.insertWorktree({
        id: "wt-2",
        title: "Worktree 2",
        path: "/path/2",
        branch: "branch-2",
        status: "active",
        repoRoot: "/repo/b",
        isRuduManaged: true,
      });

      const resultA = repository.listWorktreesForRepo("/repo/a");
      const resultB = repository.listWorktreesForRepo("/repo/b");

      expect(resultA).toHaveLength(1);
      expect(resultA[0]!.id).toBe("wt-1");

      expect(resultB).toHaveLength(1);
      expect(resultB[0]!.id).toBe("wt-2");
    });
  });

  describe("clear", () => {
    it("removes all worktrees", () => {
      const repository = new InMemoryWorktreeRepository();

      repository.insertWorktree({
        id: "wt-1",
        title: "Worktree 1",
        path: "/path/1",
        branch: "branch-1",
        status: "active",
        repoRoot: "/repo",
        isRuduManaged: true,
      });

      repository.clear();

      expect(repository.listWorktrees()).toEqual([]);
      expect(repository.getWorktree("wt-1")).toBeUndefined();
    });
  });
});
