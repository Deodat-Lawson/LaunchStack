import { and, asc, eq } from "drizzle-orm";

import {
    CALL_NOTES_ENRICHMENT_SCHEMA_VERSION,
    EnrichmentInputSchema,
    callNotesEnrichmentRuns,
} from "@launchstack/features/call-notes";

import { getWebCallNotesApplication } from "./application";
import { ConfiguredCallNotesEnrichmentModel } from "./enrichment-model";
import { getEngine } from "~/server/engine";

export async function processQueuedCallNotesEnrichment(
    companyId: string,
    callId: string
): Promise<boolean> {
    const db = getEngine().db;
    const company = BigInt(companyId);
    const [run] = await db
        .select()
        .from(callNotesEnrichmentRuns)
        .where(
            and(
                eq(callNotesEnrichmentRuns.companyId, company),
                eq(callNotesEnrichmentRuns.callId, callId),
                eq(callNotesEnrichmentRuns.status, "queued")
            )
        )
        .orderBy(asc(callNotesEnrichmentRuns.createdAt))
        .limit(1);
    if (!run) return false;

    const [claimed] = await db
        .update(callNotesEnrichmentRuns)
        .set({ status: "generating" })
        .where(
            and(
                eq(callNotesEnrichmentRuns.id, run.id),
                eq(callNotesEnrichmentRuns.status, "queued")
            )
        )
        .returning({ id: callNotesEnrichmentRuns.id });
    if (!claimed) return false;

    try {
        const application = getWebCallNotesApplication();
        const snapshot = await application.getCall({
            companyId,
            actorUserId: run.requestedByUserId,
            callId,
        });
        if (!snapshot.note || snapshot.transcript.length === 0) {
            throw new Error("Call enrichment requires an owner-visible Note and Transcript");
        }
        const input = EnrichmentInputSchema.parse({
            schemaVersion: CALL_NOTES_ENRICHMENT_SCHEMA_VERSION,
            callId,
            transcriptFingerprint: run.transcriptFingerprint,
            transcript: snapshot.transcript,
            gaps: snapshot.gaps,
            bookmarks: snapshot.bookmarks,
            note: snapshot.note,
        });
        const result = await new ConfiguredCallNotesEnrichmentModel().generate(input);
        await application.completeEnrichment({
            companyId,
            callId,
            enrichmentRunId: run.id,
            result,
        });
        return true;
    } catch (error) {
        await db
            .update(callNotesEnrichmentRuns)
            .set({
                status: "failed",
                resolvedAt: new Date(),
                errorCode: "enrichment_generation_failed",
                errorMessage:
                    error instanceof Error ? error.message.slice(0, 1_024) : "Unknown error",
            })
            .where(eq(callNotesEnrichmentRuns.id, run.id));
        throw error;
    }
}
