import type {
  PrepareSessionInput,
  RemoteReviewSessionStatus,
  StatusUpdateInput,
} from "./types";

export function validatePrepareSessionInput(input: PrepareSessionInput) {
  if (typeof input.repo !== "string" || !input.repo.includes("/")) {
    throw new Error("repo must be in owner/name format.");
  }

  if (typeof input.number !== "number" || !Number.isInteger(input.number) || input.number <= 0) {
    throw new Error("number must be a positive pull request number.");
  }

  if (typeof input.headSha !== "string" || input.headSha.trim().length === 0) {
    throw new Error("headSha is required.");
  }

  if (typeof input.githubToken !== "string" || input.githubToken.trim().length === 0) {
    throw new Error("githubToken is required.");
  }

  return {
    repo: input.repo.trim(),
    number: input.number,
    headSha: input.headSha.trim(),
    githubToken: input.githubToken.trim(),
  };
}

export function validateStatusUpdate(input: StatusUpdateInput) {
  const statuses: RemoteReviewSessionStatus[] = [
    "prepared",
    "indexed",
    "launched",
    "stale",
    "failed",
  ];

  if (!statuses.includes(input.status as RemoteReviewSessionStatus)) {
    throw new Error("status is invalid.");
  }

  return {
    status: input.status as RemoteReviewSessionStatus,
    lastError: typeof input.lastError === "string" ? input.lastError : null,
  };
}
