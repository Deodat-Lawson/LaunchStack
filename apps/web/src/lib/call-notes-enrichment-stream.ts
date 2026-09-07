import { z } from "zod";
import { CallSnapshotSchema } from "@launchstack/pipelines/call-notes/contracts";

/** Preview text is provisional; only a completed, validated proposal can be accepted. */
export const EnrichmentStreamEventSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("progress"),
        runId: z.string().min(1),
        status: z.enum(["queued", "generating"]),
        markdown: z.string().max(120_000),
    }),
    z.object({ type: z.literal("complete"), snapshot: CallSnapshotSchema }),
    z.object({ type: z.literal("error"), message: z.string().min(1) }),
]);
export type EnrichmentStreamEvent = z.infer<typeof EnrichmentStreamEventSchema>;

export interface EnrichmentPreviewState {
    callId: string;
    runId: string | null;
    status: "queued" | "generating";
    markdown: string;
    error?: string;
}
