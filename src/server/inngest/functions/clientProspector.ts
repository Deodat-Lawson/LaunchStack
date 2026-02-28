// Inngest background function for the Client Prospector pipeline.
//
// When a user submits a prospecting request (e.g. "find law firms near Austin
// that need IT consulting"), the API route creates a DB row and sends an event
// to Inngest. This function picks up the event and runs the pipeline:
//
//   Step 1 "run-pipeline": calls runClientProspector() which does:
//     planning (LLM) -> searching (Foursquare) -> scoring (LLM)
//     Status updates happen via the onStageChange callback.
//
//   Step 2 "persist": saves the results to the DB and marks the job "completed".
//
// If anything fails after 3 retries, the onFailure handler marks the job
// as "failed" with the error message.
//
// This separation means runClientProspector() is a pure pipeline function
// (no DB writes), while this Inngest wrapper owns persistence and status.

import { inngest } from "../client";
import { runClientProspector } from "~/lib/tools/client-prospector/run";
import { updateJobResults, updateJobStatus } from "~/lib/tools/client-prospector/db";
import {
    ProspectorEventDataSchema,
    type ProspectorEventData,
    type ProspectorOutput,
} from "~/lib/tools/client-prospector/types";
import type { ClientProspectorPipelineStage } from "~/lib/tools/client-prospector/run";

// Safely extract an error message from any thrown value.
// Inngest can throw Error objects, strings, or anything else.
function toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }

    if (typeof error === "string" && error.length > 0) {
        return error;
    }

    try {
        return JSON.stringify(error);
    } catch {
        return "Unknown client prospector pipeline error";
    }
}

// Inngest serializes bigint as a string in event payloads,
// so we need to convert it back.
function parseCompanyId(companyId: string): bigint {
    try {
        return BigInt(companyId);
    } catch {
        throw new Error(`Invalid client prospector companyId: ${companyId}`);
    }
}

// Update the job status in the DB, or throw if the job was not found.
// This catches cases where the job was deleted between steps.
async function updateStatusOrThrow(
    jobId: string,
    companyId: bigint,
    status: ClientProspectorPipelineStage | "completed" | "failed",
    errorMessage?: string,
) {
    const updated = await updateJobStatus(jobId, companyId, status, errorMessage);
    if (!updated) {
        throw new Error(`Client prospector job not found for status update: ${jobId}`);
    }
}

// Persist the pipeline results to the DB, or throw if the job was not found.
async function persistResultsOrThrow(
    jobId: string,
    companyId: bigint,
    output: ProspectorOutput,
) {
    const updated = await updateJobResults(jobId, companyId, output);
    if (!updated) {
        throw new Error(`Client prospector job not found for result persistence: ${jobId}`);
    }
}

// Build the input object that runClientProspector expects from the event data.
// The event payload has all the fields we need — just restructure them.
function toPipelineInput(eventData: ProspectorEventData) {
    return {
        query: eventData.query,
        companyContext: eventData.companyContext,
        location: eventData.location,
        radius: eventData.radius,
        ...(eventData.categories ? { categories: eventData.categories } : {}),
    };
}

export const clientProspectorJob = inngest.createFunction(
    {
        id: "client-prospector-job",
        name: "Client Prospector Pipeline",
        retries: 3,

        // If the function fails after all retries, mark the job as "failed"
        // in the DB so the frontend can show the error to the user.
        onFailure: async ({ error, event }) => {
            const parsed = ProspectorEventDataSchema.safeParse(event.data);
            if (!parsed.success) {
                console.error("[ClientProspector] Failed job with invalid event payload:", parsed.error);
                return;
            }

            try {
                await updateStatusOrThrow(
                    parsed.data.jobId,
                    parseCompanyId(parsed.data.companyId),
                    "failed",
                    toErrorMessage(error),
                );
            } catch (failureError) {
                console.error("[ClientProspector] Failed to mark job as failed:", failureError);
            }
        },
    },
    { event: "client-prospector/run.requested" },
    async ({ event, step }) => {
        // Validate and parse the event payload using the Zod schema.
        // This ensures all required fields are present and correctly typed.
        const eventData = ProspectorEventDataSchema.parse(event.data);
        const jobId = eventData.jobId;
        const companyId = parseCompanyId(eventData.companyId);

        // Step 1: Run the pipeline (planning -> searching -> scoring).
        // The onStageChange callback updates the DB status as each stage starts,
        // so the frontend can show progress to the user.
        const output = (await step.run("run-pipeline", async () => {
            let lastStage: ClientProspectorPipelineStage | null = null;

            const onStageChange = async (stage: ClientProspectorPipelineStage) => {
                // Skip duplicate stage updates (e.g. if the pipeline
                // calls onStageChange("searching") multiple times).
                if (stage === lastStage) return;
                lastStage = stage;
                await updateStatusOrThrow(jobId, companyId, stage);
            };

            // Start with "planning" status so the user sees progress immediately.
            await onStageChange("planning");

            return runClientProspector(toPipelineInput(eventData), {
                onStageChange,
            });
        })) as ProspectorOutput;

        // Step 2: Save results to DB and mark the job as "completed".
        // This is a separate Inngest step so that if it fails, Inngest
        // retries just the persistence, not the whole pipeline.
        return (await step.run("persist", async () => {
            await persistResultsOrThrow(jobId, companyId, output);
            await updateStatusOrThrow(jobId, companyId, "completed");
            return output;
        })) as ProspectorOutput;
    },
);
