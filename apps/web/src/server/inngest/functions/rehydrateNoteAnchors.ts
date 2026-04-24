/**
 * Inngest Function — Rehydrate Note Anchors
 *
 * Fires after a new document version finishes OCR/chunking. Re-anchors
 * every sticky note on the document against the new version: exact match
 * (resolved), fuzzy match (drifted), or neither (orphaned). See
 * `~/server/notes/rehydrate-anchors` for the matching algorithm.
 *
 * The handler is idempotent — running it twice is a no-op — so the
 * event can be safely replayed / retried. We also guard against racing
 * the OCR pipeline by polling for chunks before running the rehydration.
 */

import { inngest } from "../client";
import {
    rehydrateNotesForDocument,
    waitForVersionChunks,
} from "~/server/notes/rehydrate-anchors";

export const rehydrateNoteAnchorsJob = inngest.createFunction(
    {
        id: "rehydrate-note-anchors",
        name: "Rehydrate Note Anchors",
        retries: 3,
        onFailure: async ({ error, event }) => {
            console.error(
                `[RehydrateAnchors] failed: ${JSON.stringify(event.data)}`,
                error,
            );
        },
    },
    { event: "notes-anchors/rehydrate.requested" },
    async ({ event, step }) => {
        const data = event.data as { documentId: number; versionId: number };
        const { documentId, versionId } = data;

        // Wait for the OCR pipeline to finish writing chunks for the new
        // version. processDocument typically emits this event after
        // finalizeStorage — but we stay defensive so manual replays or
        // unusual ordering don't produce false "orphaned" results just
        // because we arrived early.
        const ready = await step.run("wait-for-chunks", async () => {
            return waitForVersionChunks(documentId, versionId, {
                maxWaitMs: 180_000,
            });
        });

        if (!ready) {
            console.warn(
                `[RehydrateAnchors] chunks never appeared for doc=${documentId} v=${versionId}; skipping`,
            );
            return { skipped: true };
        }

        const result = await step.run("rehydrate", async () => {
            return rehydrateNotesForDocument(documentId, versionId);
        });

        console.log(
            `[RehydrateAnchors] doc=${documentId} v=${versionId}: ` +
                `considered=${result.considered} resolved=${result.resolved} ` +
                `drifted=${result.drifted} orphaned=${result.orphaned} skipped=${result.skipped}`,
        );

        return result;
    },
);
