/**
 * Distribution discovery run on the worker (design §4.6 "Background jobs").
 *
 * Stages 1–4 are one step. By default the search stops at the shortlist and
 * a profile is written when someone opens the company. When `enrichOnRun` is
 * set, candidates are researched in waves (keyless: five at a time) so a
 * retry still skips completed step ids. Publishing dossiers into Sources and
 * metering are host ports because they need apps/web's storage and ledger.
 */
import {
    DistributionRunEventDataSchema,
    createDefaultPorts,
    createKeylessPorts,
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
import { canPublishToSources } from "~/server/prospects/keyless-run";
import { prospectEmbedder, prospectFitJudge } from "~/server/prospects/matching";
import { processDocumentUpload } from "~/server/services/document-upload";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";

/** Same bound keyless ports use in-process; live stays one at a time (model cost). */
const KEYLESS_ENRICH_CONCURRENCY = 5;

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

        // createDefaultPorts resolves its models when called, and a step body runs
        // outside the handler's async context: each step that builds ports or
        // calls a model enters the workspace's models itself.
        const aiUse = { feature: "distribution", userId: data.userId, enforce: false } as const;
        const inWorkspace = <T>(work: () => Promise<T>) =>
            withWorkspaceChatModels(companyId, aiUse, work);
        const ports = async () => {
            const embed = await prospectEmbedder(companyId);
            // Same job, same steps; what differs is where companies come from.
            if (data.mode === "keyless")
                return createKeylessPorts({
                    publishDossier: canPublishToSources() ? publishDossier : null,
                    debitCredits: null,
                    embed,
                    judgeFit: await prospectFitJudge(companyId),
                });
            return createDefaultPorts({
                publishDossier,
                embed,
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
        };

        const startedAtIso = await step.run("start", async () => new Date().toISOString());

        const prepared = await step.run("prepare", () =>
            inWorkspace(async () => prepareRun(ctx, await ports()))
        );

        const results: EnrichCandidateResult[] = [];
        if (data.enrichOnRun) {
            const concurrency = data.mode === "keyless" ? KEYLESS_ENRICH_CONCURRENCY : 1;
            const ids = prepared.candidateRelationshipIds;
            for (let i = 0; i < ids.length; i += concurrency) {
                const batch = ids.slice(i, i + concurrency);
                const batchResults = await Promise.all(
                    batch.map((relationshipId, offset) =>
                        step.run(`enrich-${i + offset}`, () =>
                            inWorkspace(async () =>
                                enrichCandidate(ctx, await ports(), {
                                    relationshipId,
                                    profile: prepared.profile,
                                })
                            )
                        )
                    )
                );
                results.push(...batchResults);
            }
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
