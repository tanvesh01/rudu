import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SyncJsonlSessionRepository } from "./SyncJsonlSessionRepository.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loads sibling-worktree session records when repoRoot is persisted", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "rudu-sync-session-"));
  tempDirs.push(dataDir);

  const repoRoot = "/tmp/repo-root";
  const siblingWorktreePath = "/tmp/repo-root-feature";
  const sessionId = crypto.randomUUID();
  const worktreeId = crypto.randomUUID();

  const writer = new SyncJsonlSessionRepository({
    dataDir,
    projectRoot: repoRoot,
  });

  writer.insertSession({
    id: sessionId,
    title: "Sibling Worktree Session",
    prompt: "build feature",
    runtimeType: "pi-sdk",
    status: "queued",
    originalCwd: siblingWorktreePath,
    effectiveCwd: siblingWorktreePath,
    repoRoot,
    worktreePath: siblingWorktreePath,
    worktreeId,
    worktreeStatus: "ready",
    cleanupPolicy: "preserve_on_failure",
    cleanupStatus: "none",
    canResume: false,
    recovered: false,
    queuedAt: Date.now(),
  });

  const reader = new SyncJsonlSessionRepository({
    dataDir,
    projectRoot: repoRoot,
  });

  const sessions = reader.listSessions();
  expect(sessions).toHaveLength(1);
  expect(sessions[0]!.id).toBe(sessionId);
  expect(sessions[0]!.repoRoot).toBe(repoRoot);
  expect(sessions[0]!.worktreePath).toBe(siblingWorktreePath);
});

test("filters out records that belong to another repoRoot", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "rudu-sync-session-"));
  tempDirs.push(dataDir);

  const scopedRoot = "/tmp/repo-a";
  const otherRoot = "/tmp/repo-b";

  const writer = new SyncJsonlSessionRepository({
    dataDir,
    projectRoot: scopedRoot,
  });

  writer.insertSession({
    id: crypto.randomUUID(),
    title: "Other Repo Session",
    runtimeType: "pi-sdk",
    status: "queued",
    effectiveCwd: "/tmp/repo-b-feature",
    repoRoot: otherRoot,
    worktreePath: "/tmp/repo-b-feature",
    worktreeId: crypto.randomUUID(),
    worktreeStatus: "ready",
    cleanupPolicy: "preserve_on_failure",
    cleanupStatus: "none",
    canResume: false,
    recovered: false,
    queuedAt: Date.now(),
  });

  const reader = new SyncJsonlSessionRepository({
    dataDir,
    projectRoot: scopedRoot,
  });

  expect(reader.listSessions()).toHaveLength(0);
});
