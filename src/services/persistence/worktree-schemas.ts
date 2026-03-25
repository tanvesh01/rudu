// src/services/persistence/worktree-schemas.ts
// Zod schemas for runtime type validation of worktree persistence data

import { z } from "zod";
import type { WorktreeLifecycleStatus } from "../../domain/worktree.js";

// Re-export type for convenience
export type { WorktreeLifecycleStatus };

// Zod schema for worktree lifecycle status
export const WorktreeLifecycleStatusSchema = z.enum([
  "creating",
  "active",
  "archived",
  "cleanup_pending",
  "cleanup_failed",
  "removed",
]) as z.ZodType<WorktreeLifecycleStatus>;

// Main Worktree Schema - used for both storage and domain
export const PersistedWorktreeSchema = z.object({
  // Persistence metadata
  schemaVersion: z.literal(1),
  projectRoot: z.string(), // For filtering by repo

  // Core worktree data
  id: z.string().uuid(),
  title: z.string(),
  path: z.string(),
  branch: z.string(),
  status: WorktreeLifecycleStatusSchema,

  // Repository association
  repoRoot: z.string(),

  // Management flag
  isRuduManaged: z.boolean().default(true),

  // Optional fields
  error: z.string().optional(),
  archivedAt: z.number().int().positive().optional(),
  removedAt: z.number().int().positive().optional(),

  // Timestamps
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
});

export type PersistedWorktree = z.infer<typeof PersistedWorktreeSchema>;

// For writing to JSONL
export type JsonlWorktreeRecord = PersistedWorktree;

// For inserting (omits auto-generated timestamps and persistence metadata set by repository)
export const NewPersistedWorktreeSchema = PersistedWorktreeSchema.omit({
  schemaVersion: true,
  projectRoot: true,
  createdAt: true,
  updatedAt: true,
});
export type NewPersistedWorktree = z.infer<typeof NewPersistedWorktreeSchema>;

// For patching (partial updates)
export const PersistedWorktreePatchSchema = PersistedWorktreeSchema.partial().omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  schemaVersion: true,
  projectRoot: true,
});
export type PersistedWorktreePatch = z.infer<typeof PersistedWorktreePatchSchema>;

// Helper: Parse JSONL line safely for worktrees
export function parseWorktreeJsonlLine(line: string): PersistedWorktree | null {
  try {
    const parsed = JSON.parse(line);
    const result = PersistedWorktreeSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

// Helper: Convert worktree to JSONL string
export function serializeWorktree(worktree: PersistedWorktree): string {
  return JSON.stringify(worktree) + "\n";
}
