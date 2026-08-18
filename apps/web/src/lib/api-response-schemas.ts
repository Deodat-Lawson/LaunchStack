/**
 * B8 — response shapes for the storage-deletion APIs.
 *
 * The codebase already has a formal place to declare what an API *accepts*
 * (~/lib/validation.ts, 40-odd request schemas). It had nowhere to declare
 * what an API *returns*. B7 added several genuinely new response fields —
 * the computed `status`, the `storedStatus` it is compared against,
 * `otherRequestIds` for the duplicate-request case, and per-item detail for
 * "partial" — and until now they existed only informally, as whatever the
 * function happened to build. Nothing checked the shape, and nothing would
 * notice it drifting.
 *
 * These schemas are that missing declaration. Same library as the request
 * side (zod) so there is one way to describe a contract here, not two.
 *
 * ENFORCEMENT (B8 judgment call)
 * ------------------------------
 * validateApiResponse only actually runs outside production, and never
 * throws. A response-shape checker is a safety net, not a dependency — a bug
 * in the net itself must not be able to take down a request a real user is
 * making. In dev and test it logs loudly; in production it is a no-op that
 * returns the value untouched.
 */

import { z } from "zod";

/** The frozen deletion status enum (Decision 6). Never extended here. */
export const DeletionStatusSchema = z.enum([
  "queued",
  "completed",
  "partial",
  "manual_review",
  "quarantined",
]);

/** Per-item detail — the thing that makes a "partial" status actionable. */
export const DeletionStatusItemSchema = z.object({
  itemId: z.number(),
  adapter: z.string(),
  storageLocationId: z.string(),
  key: z.string(),
  /** The row's own state; "LINKED" for a B5 cross-document follower. */
  state: z.string(),
  /** What that state means once a LINKED item is resolved to its leader. */
  effectiveState: z.string(),
  linkedToItemId: z.number().optional(),
  objectLifecycleState: z.string().optional(),
  attempts: z.number(),
  lastError: z.string().optional(),
  blockingCompletion: z.boolean(),
});

export const DeletionStatusPayloadSchema = z.object({
  scope: z.enum(["request", "document"]),
  /** True when answered from a tombstone — the working rows are gone. */
  purged: z.boolean(),
  requestId: z.number().optional(),
  documentId: z.number().optional(),
  documentVersionId: z.number().optional(),
  status: DeletionStatusSchema,
  /** The maintained summary column, for drift detection. */
  storedStatus: DeletionStatusSchema.optional(),
  requestedBy: z.string().optional(),
  createdAt: z.union([z.date(), z.string()]).optional(),
  completedAt: z.union([z.date(), z.string()]).optional(),
  itemCount: z.number(),
  counts: z.record(z.string(), z.number()),
  items: z.array(DeletionStatusItemSchema),
  /** Redundant in-flight requests for the same document, surfaced not hidden. */
  otherRequestIds: z.array(z.number()).optional(),
});

/** B7 — GET deletion status, by request id or by document id. */
export const DeletionStatusResponseSchema = z.union([
  DeletionStatusPayloadSchema.extend({ success: z.literal(true) }),
  z.object({
    success: z.literal(true),
    documentId: z.number(),
    deletionRequested: z.literal(false),
    message: z.string(),
  }),
  z.object({ success: z.literal(false), error: z.string() }),
]);

/** B4 — DELETE a single document. */
export const DeleteDocumentResponseSchema = z.union([
  z.object({
    success: z.literal(true),
    status: DeletionStatusSchema,
    requestId: z.number().optional(),
    documentId: z.number(),
    message: z.string(),
  }),
  z.object({ success: z.literal(false), error: z.string() }),
]);

/** B5 — DELETE a batch of documents. */
export const BatchDeleteDocumentEntrySchema = z.object({
  documentId: z.number(),
  status: DeletionStatusSchema,
  requestId: z.number().optional(),
  /** Files this document shares with an earlier document in the batch. */
  linkedItemCount: z.number().optional(),
});

export const BatchDeleteDocumentsResponseSchema = z.union([
  z.object({
    success: z.literal(true),
    status: DeletionStatusSchema,
    accepted: z.number(),
    alreadyCompleted: z.number(),
    dedupedFileCount: z.number(),
    documents: z.array(BatchDeleteDocumentEntrySchema),
    message: z.string(),
  }),
  z.object({ success: z.literal(false), error: z.string() }),
]);

export type DeletionStatusPayloadShape = z.infer<typeof DeletionStatusPayloadSchema>;

/**
 * Check a response body against its declared shape without ever being able
 * to break the response. Returns the body unchanged, always.
 *
 * Production: no-op. Dev/test: logs the specific failing paths.
 */
export function validateApiResponse<T>(
  schema: z.ZodType<unknown>,
  body: T,
  context: string,
): T {
  if (process.env.NODE_ENV === "production") return body;

  try {
    const result = schema.safeParse(body);
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      console.error(`[ResponseShape] ${context} does not match its declared shape — ${issues}`);
    }
  } catch (err) {
    // The checker itself failing must never surface to a caller.
    console.error(`[ResponseShape] validation threw for ${context}:`, err);
  }

  return body;
}

/**
 * Same check, but returning the result instead of logging it — for tests
 * that want to assert a shape rather than watch a console.
 */
export function checkApiResponse(
  schema: z.ZodType<unknown>,
  body: unknown,
): { ok: true } | { ok: false; issues: string[] } {
  const result = schema.safeParse(body);
  if (result.success) return { ok: true };
  return {
    ok: false,
    issues: result.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    ),
  };
}
