import { z } from "zod";
export const TOPIC_RETRIEVAL_VERSION = "vantage-topic-retrieval/v1" as const;
export const TopicRetrievalContextSchema = z
    .object({
        schemaVersion: z.literal(TOPIC_RETRIEVAL_VERSION),
        mode: z.literal("topic-first"),
        guidanceLabel: z.literal("owner notes, not evidence"),
        topics: z
            .array(
                z
                    .object({
                        id: z.string().min(1).max(200),
                        title: z.string().min(1).max(200),
                        openQuestions: z.array(z.string().min(1).max(500)).max(12),
                    })
                    .strict()
            )
            .max(50),
        seedReasons: z
            .array(
                z
                    .object({
                        ref: z.string().min(1).max(200),
                        reason: z.enum(["watch", "carryover", "question", "change", "lane", "recency"]),
                    })
                    .strict()
            )
            .max(200),
        lane: z
            .object({
                outcome: z.enum(["admitted", "none_eligible", "capacity_shortfall"]),
                candidates: z.number().int().nonnegative().max(3),
                admitted: z.number().int().nonnegative().max(1),
            })
            .strict(),
        traceHash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict();
export type TopicRetrievalContext = z.infer<typeof TopicRetrievalContextSchema>;
