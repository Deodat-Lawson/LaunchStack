/**
 * An extraction table on the worker, for deployments that set
 * EXTRACTION_EXECUTOR=worker. One `step.run` per unit (a batch of rows), so
 * a restart replays finished units from Inngest's memo and redoes at most
 * the batch in flight. One job per workspace at a time, so when a unit
 * starts no row of the table is being read: rows a dead attempt left claimed
 * are put back before each unit.
 */
import { advanceTable } from "@launchstack/pipelines/extraction";
import { createExtractionStore } from "@launchstack/pipelines/extraction/db";

import {
    createExtractionPorts,
    createUnitGate,
    extractionAiUse,
    MAX_UNITS,
} from "~/server/extraction/executor";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";

import { inngest } from "../client";

function toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === "string" && error.length > 0) return error;
    return "The extraction failed";
}

export const extractionRunJob = inngest.createFunction(
    {
        id: "extraction-run",
        name: "Extraction Run",
        retries: 2,
        concurrency: [{ key: "event.data.companyId", limit: 1 }, { limit: 6 }],
        onFailure: async ({ error, event }) => {
            const tableId = Number(event.data.event.data.tableId);
            if (!Number.isInteger(tableId)) return;
            try {
                await createExtractionStore().finish(
                    tableId,
                    "failed",
                    toErrorMessage(error),
                    new Date()
                );
            } catch (failureError) {
                console.error("[extraction] Could not mark table failed:", failureError);
            }
        },
    },
    { event: "extraction/run.requested" },
    async ({ event, step }) => {
        const tableId = Number(event.data.tableId);
        // Units count against whoever made the table; a table under way is never stopped.
        const aiUse = extractionAiUse(event.data.userId ?? null);
        const keepGoing = createUnitGate();
        let last = "skipped";
        for (let i = 0; i < MAX_UNITS; i++) {
            // A step body doesn't inherit the handler's async context: enter the
            // workspace's model scope inside the step.
            const outcome = await step.run(`unit-${i}`, () =>
                withWorkspaceChatModels(BigInt(event.data.companyId), aiUse, async () => {
                    const ports = createExtractionPorts();
                    await ports.store.releaseRunningRows(tableId);
                    return advanceTable(ports, tableId);
                })
            );
            last = outcome.state;
            if (!keepGoing(outcome)) break;
        }
        return { tableId, state: last };
    }
);
