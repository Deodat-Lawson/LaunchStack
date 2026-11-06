import { z } from "zod";
import type { DemoReport } from "~/app/employer/tools/vantage/demo-contract";

const ref = z
    .object({
        kind: z.enum(["company", "doc", "ev", "obs", "cm", "public"]),
        id: z.string().min(1),
        version: z.string().min(1),
    })
    .strict();
const figure = z
    .object({
        label: z.string().min(1).max(32),
        value: z.string().min(1).max(32),
        tone: z.enum(["neutral", "concern", "positive"]),
        refs: z.array(ref).min(1).max(3),
        derivation: z
            .object({
                op: z.enum(["difference", "sum", "ratio", "count"]),
                inputs: z
                    .array(z.object({ value: z.number().finite(), ref }).strict())
                    .min(1)
                    .max(8),
            })
            .strict()
            .optional(),
    })
    .strict();
const report = z.object({
    headline: z.string().min(1).max(120).optional(),
    brief: z.string().min(1).max(300).optional(),
    keyFigures: z.array(figure).max(3).optional(),
});
const topic = z.object({
    whyNow: z.string().min(1).max(160).optional(),
    recommendation: z
        .object({
            call: z.string().min(1).max(140),
            confidence: z.enum(["low", "medium", "high"]),
            because: z.string().min(1).max(240),
            refs: z.array(ref).min(1).max(4),
            wouldChangeIf: z.string().min(1).max(160),
        })
        .strict()
        .nullable()
        .optional(),
});

/** Checks additive read fields; citation, arithmetic and grounding are generation invariants. */
export function extractDemoV2Fields(
    value: unknown
): Pick<DemoReport, "headline" | "brief" | "keyFigures"> {
    const base = z
        .object({ topics: z.array(z.unknown()) })
        .passthrough()
        .parse(value);
    for (const item of base.topics) topic.parse(item);
    return report.parse(base);
}
