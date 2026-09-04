/**
 * Distribution discovery run on the worker (design §4.6 "Background jobs").
 *
 * Stages 1–4 are one step; every candidate's research is its own step so a
 * retry replays completed candidates instead of re-researching them; the
 * summary is the last step. Publishing dossiers into Sources and metering
 * are host ports because they need apps/web's storage and ledger.
 */
import {
    DistributionRunEventDataSchema,
    createDefaultPorts,
    enrichCandidate,
    failRun,
    finalizeRun,
    prepareRun,
    type EnrichCandidateResult,
    type PublishDossierInput,
} from "@launchstack/pipelines/distribution";

import { inngest } from "../client";
import { uploadFile } from "~/lib/storage";
import { debitTokens } from "~/lib/credits";
import { processDocumentUpload } from "~/server/services/document-upload";

function toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === "string" && error.length > 0) return error;
    try {
        return JSON.stringify(error);
    } catch {
        return "Unknown distribution pipeline error";
    }
}

export const distributionRunJob = inngest.createFunction(
    {
        id: "distribution-run",
        name: "Distribution Discovery Run",
        retries: 1,
        concurrency: [{ key: "event.data.companyId", limit: 2 }, { limit: 8 }],
        onFailure: async ({ error, event }) => {
            const parsed = DistributionRunEventDataSchema.safeParse(event.data.event.data);
            if (!parsed.success) {
                console.error("[distribution] Failed run with invalid payload:", parsed.error);
                return;
            }
            try {
                await failRun(
                    { runId: parsed.data.runId, companyId: BigInt(parsed.data.companyId) },
                    toErrorMessage(error)
                );
            } catch (failureError) {
                console.error("[distribution] Could not mark run failed:", failureError);
            }
        },
    },
    { event: "distribution/run.requested" },
    async ({ event, step }) => {
        const data = DistributionRunEventDataSchema.parse(event.data);
        const companyId = BigInt(data.companyId);
        const ctx = { runId: data.runId, companyId, programId: data.programId };

        const publishDossier = async (input: PublishDossierInput) => {
            const stored = await uploadFile({
                filename: input.filename,
                data: Buffer.from(input.markdown, "utf8"),
                contentType: "text/markdown",
                userId: data.userId,
                companyId,
            });
            const upload = await processDocumentUpload({
                user: { userId: data.userId, companyId },
                documentName: input.title,
                rawDocumentUrl: stored.url,
                creationKey: input.creationKey,
                category: input.category,
                explicitStorageType: stored.provider,
                mimeType: "text/markdown",
                originalFilename: input.filename,
                requestUrl: data.requestUrl,
            });
            return { documentId: upload.document.id };
        };

        const ports = () =>
            createDefaultPorts({
                publishDossier,
                debitCredits: async ({ amount, description, referenceId }) => {
                    await debitTokens({
                        companyId,
                        amount,
                        service: "distribution_research",
                        description,
                        referenceId,
                    });
                },
            });

        const startedAtIso = await step.run("start", async () => new Date().toISOString());

        const prepared = await step.run("prepare", () => prepareRun(ctx, ports()));

        const results: EnrichCandidateResult[] = [];
        for (const [index, relationshipId] of prepared.candidateRelationshipIds.entries()) {
            const result = await step.run(`enrich-${index}`, () =>
                enrichCandidate(ctx, ports(), { relationshipId, profile: prepared.profile })
            );
            results.push(result);
        }

        const summary = await step.run("finalize", () =>
            finalizeRun(ctx, prepared, results, new Date(startedAtIso))
        );
        return {
            status: "completed",
            enriched: summary.enriched,
            shortlisted: summary.shortlisted,
        };
    }
);
