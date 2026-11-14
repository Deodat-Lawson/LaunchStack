import { z } from "zod";

const text = (max: number) =>
    z
        .string()
        .min(1)
        .max(max)
        .refine(value => value.trim().length > 0);

/** Model-facing retrieval preferences and unresolved questions bound to a host-owned trace. */
export const WeeklyReviewRetrievalContextSchema = z
    .object({
        schemaVersion: z.literal("vantage-dynamic-retrieval/v3"),
        mode: z.enum(["role", "internal-research", "combined"]),
        businessRole: z
            .object({
                primaryRole: text(80),
                responsibilities: z.array(text(160)).max(8),
                priorities: z.array(text(160)).max(8),
                revision: z.number().int().positive().safe(),
            })
            .strict()
            .optional(),
        internalDecision: z
            .object({
                outcome: z.enum(["STOP", "INTERNAL_FOLLOW_UP", "INSUFFICIENT_EVIDENCE"]),
                questions: z.array(text(300)).max(3),
            })
            .strict()
            .optional(),
        traceHash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict();

export type WeeklyReviewRetrievalContext = z.infer<typeof WeeklyReviewRetrievalContextSchema>;

export function parseWeeklyReviewRetrievalContext(raw: unknown): WeeklyReviewRetrievalContext {
    return WeeklyReviewRetrievalContextSchema.parse(raw);
}

/** Structural validation. The host binds traceHash to its exact persisted selection trace. */
export function validateWeeklyReviewRetrievalContext(raw: unknown): void {
    parseWeeklyReviewRetrievalContext(raw);
}

export const WEEKLY_REVIEW_RETRIEVAL_PROMPT =
    " The legacy role field describes workspace permissions. Infer no business responsibilities from that field. The supplied retrievalContext.businessRole is a confirmed business preference and grants no authorization. Retrieval outcome and follow-up gap questions describe unresolved hypotheses. They do not establish facts or prove that evidence exists. Ground claims only in supplied exact-version sources, preserve unknowns and insufficient evidence, and keep unresolved questions explicit when relevant. Continue without tools, fetching or actions.";
