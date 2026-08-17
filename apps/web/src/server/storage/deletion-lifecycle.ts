import type { DeleteResult } from "@launchstack/core/storage";

export type DeletionItemState =
  | "PENDING"
  | "IN_FLIGHT"
  | "WAITING_RETRY"
  | "RETRYABLE_FAILED"
  | "DELETED"
  | "NOT_FOUND"
  | "BLOCKED"
  | "QUARANTINED";

export type DeletionApiStatus =
  | "queued"
  | "completed"
  | "partial"
  | "manual_review"
  | "quarantined";

export function mapDeleteOutcomeToItemState(result: DeleteResult): DeletionItemState {
  switch (result.outcome) {
    case "deleted":
      return "DELETED";
    case "not_found":
      return "NOT_FOUND";
    case "retryable":
      return "WAITING_RETRY";
    case "blocked":
      return "BLOCKED";
    case "rejected":
      return "QUARANTINED";
  }
}

export interface DeriveDeletionStatusInput {
  itemStates: readonly DeletionItemState[];
  relationalPurgeDone: boolean;
  hasApprovedQuarantineBypass?: boolean;
}

/**
 * Frozen status dominance rules:
 * quarantined > manual_review > completed > partial > queued.
 */
export function deriveDeletionApiStatus(input: DeriveDeletionStatusInput): DeletionApiStatus {
  const { itemStates, relationalPurgeDone, hasApprovedQuarantineBypass = false } = input;

  const hasQuarantined = itemStates.includes("QUARANTINED");
  if (hasQuarantined && !hasApprovedQuarantineBypass) {
    return "quarantined";
  }

  if (itemStates.includes("BLOCKED")) {
    return "manual_review";
  }

  const allRequiredTerminal = itemStates.every(
    (state) => state === "DELETED" || state === "NOT_FOUND",
  );
  if (allRequiredTerminal && relationalPurgeDone) {
    return "completed";
  }

  const hasTerminal = itemStates.some(
    (state) =>
      state === "DELETED" ||
      state === "NOT_FOUND" ||
      state === "BLOCKED" ||
      state === "QUARANTINED" ||
      state === "RETRYABLE_FAILED",
  );

  const hasNonTerminal = itemStates.some(
    (state) => state === "PENDING" || state === "IN_FLIGHT" || state === "WAITING_RETRY",
  );

  if (hasTerminal && hasNonTerminal) {
    return "partial";
  }

  return "queued";
}
