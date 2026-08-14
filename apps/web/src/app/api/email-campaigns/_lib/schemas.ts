import { z } from "zod";

import { RecipientSchema } from "@launchstack/features/email-pipeline";

/**
 * Request schemas for the campaign lifecycle routes.
 *
 * Kept out of the route files so they can be unit-tested directly — the
 * automation schema in particular encodes a security decision (the policy is
 * not caller-supplied) that deserves a test, and a `route.ts` export would be
 * an odd thing for Next.js to carry.
 */

export const AutomatedRunSchema = z
  .object({
    name: z.string().min(1).max(256),
    goal: z.string().max(2000).optional(),
    recipients: z.array(RecipientSchema).min(1).max(500),
    mode: z.enum(["dry_run", "send"]).optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  // `.strict()` is load-bearing. The automation policy — whether a failing AI
  // review can still send, and how large an audience may be — is server
  // configuration. If this object allowed unknown keys, a caller could post
  // `policy: { requireReviewPass: false }` and, depending on how it were
  // threaded through, walk past the review gate. Rejecting the field outright
  // beats ignoring it: someone who thinks they disabled the gate finds out here.
  .strict();

export type AutomatedRunInput = z.infer<typeof AutomatedRunSchema>;
