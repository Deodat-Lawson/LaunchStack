import { and, asc, eq } from "drizzle-orm";

import {
    CALL_NOTES_ENRICHMENT_SCHEMA_VERSION,
    EnrichmentInputSchema,
    callNotesEnrichmentRuns,
} from "@launchstack/features/call-notes";

import { getWebCallNotesApplication } from "./application";
import { ConfiguredCallNotesEnrichmentModel } from "./enrichment-model";
import { getEngine } from "~/server/engine";

const PREVIEW_MAX_LENGTH = 120_000;
const PREVIEW_FLUSH_INTERVAL_MS = 250;

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
    const runId = run.id;

    const [claimed] = await db
        .update(callNotesEnrichmentRuns)
        .set({ status: "generating" })
        .where(
            and(eq(callNotesEnrichmentRuns.id, runId), eq(callNotesEnrichmentRuns.status, "queued"))
        )
        .returning({ id: callNotesEnrichmentRuns.id });
    if (!claimed) return false;

    let pendingPreview: string | undefined;
    let latestPreview = "";
    let previewTimer: NodeJS.Timeout | null = null;
    let previewWrite: Promise<void> | null = null;
    let previewWriteError: Error | undefined;
    let lastPreviewWriteAt = 0;

    function schedulePreviewFlush(): void {
        if (previewTimer !== null) return;
        const delay = Math.max(0, PREVIEW_FLUSH_INTERVAL_MS - (Date.now() - lastPreviewWriteAt));
        previewTimer = setTimeout(() => {
            previewTimer = null;
            void flushPreview().catch(error => {
                previewWriteError ??= error instanceof Error ? error : new Error(String(error));
            });
        }, delay);
    }

    async function flushPreview(): Promise<void> {
        if (previewWrite) await previewWrite;
        if (pendingPreview === undefined) return;

        const preview = pendingPreview;
        pendingPreview = undefined;
        const operation = db
            .update(callNotesEnrichmentRuns)
            .set({ previewMarkdown: preview })
            .where(
                and(
                    eq(callNotesEnrichmentRuns.id, runId),
                    eq(callNotesEnrichmentRuns.status, "generating")
                )
            )
            .then(() => undefined);
        previewWrite = operation;
        lastPreviewWriteAt = Date.now();
        try {
            await operation;
        } catch (error) {
            previewWriteError ??= error instanceof Error ? error : new Error(String(error));
            throw error;
        } finally {
            previewWrite = null;
        }

        if (pendingPreview !== undefined) schedulePreviewFlush();
    }

    function stopPreviewTimer(): void {
        if (previewTimer === null) return;
        clearTimeout(previewTimer);
        previewTimer = null;
    }

    async function flushFinalPreview(): Promise<void> {
        stopPreviewTimer();
        await flushPreview();
        stopPreviewTimer();
        if (previewWriteError) throw previewWriteError;
    }

    const rememberPreview = (markdown: string): void => {
        const preview = markdown.slice(0, PREVIEW_MAX_LENGTH);
        if (preview === latestPreview) return;
        latestPreview = preview;
        pendingPreview = preview;
        schedulePreviewFlush();
    };

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
            note: snapshot.note,
        });
        const result = await new ConfiguredCallNotesEnrichmentModel().generate(
            input,
            rememberPreview
        );
        await flushFinalPreview();
        await application.completeEnrichment({
            companyId,
            callId,
            enrichmentRunId: runId,
            result,
        });
        return true;
    } catch (error) {
        stopPreviewTimer();
        try {
            await flushPreview();
        } catch {
            // Preserve the generation error and keep the latest durable preview, if any.
        }
        await db
            .update(callNotesEnrichmentRuns)
            .set({
                status: "failed",
                resolvedAt: new Date(),
                errorCode: "enrichment_generation_failed",
                errorMessage:
                    error instanceof Error ? error.message.slice(0, 1_024) : "Unknown error",
            })
            .where(eq(callNotesEnrichmentRuns.id, runId));
        throw error;
    } finally {
        stopPreviewTimer();
    }
}
