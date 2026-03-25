// src/services/persistence/schemas.ts
// Zod schemas for runtime type validation of session persistence data

import { z } from "zod";
import type { SessionStatus, SessionRuntimeType } from "../session-manager/types.js";

// Re-export types from session-manager for convenience
export type { SessionStatus, SessionRuntimeType };

// Zod schemas for the enums (for validation)
export const SessionStatusSchema = z.enum([
  "queued",
  "starting",
  "running",
  "cancelling",
  "cancelled",
  "succeeded",
  "failed",
]) as z.ZodType<SessionStatus>;

export const SessionRuntimeTypeSchema = z.enum(["pi-sdk", "subprocess"]) as z.ZodType<SessionRuntimeType>;

export const WorktreeStatusSchema = z.enum([
  "none",
  "creating",
  "ready",
  "cleanup_pending",
  "cleanup_failed",
  "removed",
  "preserved",
]);

export const CleanupPolicySchema = z.enum([
  "always",
  "on_success",
  "preserve_on_failure",
  "never",
]);

export const CleanupStatusSchema = z.enum([
  "none",
  "pending",
  "succeeded",
  "failed",
  "skipped",
]);

// Main Session Schema - used for both storage and domain
export const PersistedSessionSchema = z.object({
  // Persistence metadata
  schemaVersion: z.literal(1),
  projectRoot: z.string(), // For filtering by repo

  // Core session data
  id: z.string().uuid(),
  title: z.string(),
  prompt: z.string().optional(),
  runtimeType: SessionRuntimeTypeSchema,
  status: SessionStatusSchema,

  // Paths
  originalCwd: z.string().optional(),
  effectiveCwd: z.string().optional(),
  repoRoot: z.string().optional(),
  worktreePath: z.string().optional(),

  // Worktree linkage - durable association by ID
  // This replaces path-only association with stable worktree identity
  worktreeId: z.string().uuid().optional(),

  // Worktree state
  worktreeStatus: WorktreeStatusSchema.default("none"),
  cleanupPolicy: CleanupPolicySchema.default("preserve_on_failure"),
  cleanupStatus: CleanupStatusSchema.default("none"),

  // PI session
  piSessionId: z.string().optional(),
  piSessionFile: z.string().optional(),
  canResume: z.boolean(),

  // Recovery
  recovered: z.boolean(),
  lastError: z.string().optional(),

  // Timestamps
  queuedAt: z.number().int().positive(),
  startedAt: z.number().int().positive().optional(),
  finishedAt: z.number().int().positive().optional(),
  cancelRequestedAt: z.number().int().positive().optional(),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
});

export type PersistedSession = z.infer<typeof PersistedSessionSchema>;

// For writing to JSONL (includes schemaVersion and projectRoot)
export type JsonlSessionRecord = PersistedSession;

// For inserting (omits auto-generated timestamps and persistence metadata set by repository)
export const NewPersistedSessionSchema = PersistedSessionSchema.omit({
  schemaVersion: true,
  projectRoot: true,
  createdAt: true,
  updatedAt: true,
});
export type NewPersistedSession = z.infer<typeof NewPersistedSessionSchema>;

// For patching (partial updates)
export const PersistedSessionPatchSchema = PersistedSessionSchema.partial().omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  schemaVersion: true,
  projectRoot: true,
});
export type PersistedSessionPatch = z.infer<typeof PersistedSessionPatchSchema>;

// Recovery patch
export const RecoveryPatchSchema = z.object({
  status: SessionStatusSchema,
  recovered: z.boolean(),
  lastError: z.string().optional(),
  worktreeStatus: WorktreeStatusSchema.optional(),
});
export type RecoveryPatch = z.infer<typeof RecoveryPatchSchema>;

// Helper: Parse JSONL line safely
export function parseJsonlLine(line: string): PersistedSession | null {
  try {
    const parsed = JSON.parse(line);
    const result = PersistedSessionSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

// Helper: Convert session to JSONL string
export function serializeSession(session: PersistedSession): string {
  return JSON.stringify(session) + "\n";
}
