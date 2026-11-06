import { z } from "zod";
import { GenerationOutputSchema } from "./generation-v1";
const text = (n: number) => z.string().trim().min(1).max(n);
export const DerivationSchemaV2 = z
    .object({
        op: z.enum(["difference", "sum", "ratio", "count"]),
        inputs: z
            .array(z.object({ value: z.number().finite(), ref: text(200) }).strict())
            .min(1)
            .max(8),
    })
    .strict();
export const RecommendationSchemaV2 = z
    .object({
        call: text(140),
        confidence: z.enum(["low", "medium", "high"]),
        because: text(240),
        refs: z.array(text(200)).min(1).max(4),
        wouldChangeIf: text(160),
    })
    .strict();
/** Reuse V1 nodes for compact schema references; the native schema is unchanged. */
export const GenerationOutputSchemaV2 = GenerationOutputSchema.extend({
    headline: text(120),
    brief: text(300),
    keyFigures: z
        .array(
            z
                .object({
                    label: text(32),
                    value: text(32),
                    tone: z.enum(["neutral", "concern", "positive"]),
                    refs: z.array(text(200)).min(1).max(3),
                    derivation: DerivationSchemaV2.optional(),
                })
                .strict()
        )
        .max(3),
    topics: z
        .array(
            GenerationOutputSchema.shape.topics.element.extend({
                proposedOwner: z.null(),
                proposedDueInDays: z.null(),
                helpRequested: z.null(),
                rationale: text(240),
                whyNow: text(160),
                recommendation: RecommendationSchemaV2.nullable(),
            })
        )
        .max(3),
}).strict();
export const GenerationCompoundSchemaV2 = z
    .object({ native: GenerationOutputSchema, experimental: GenerationOutputSchemaV2 })
    .strict();
export type GenerationOutputV2 = z.infer<typeof GenerationOutputSchemaV2>;
