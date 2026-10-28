/**
 * ExtractionPipelinePort — document ingestion (ADR-003), run as the
 * `source.version.created` (extract) and `evidence.version.extracted`
 * (index) outbox handlers.
 *
 * Both stages run under the workspace's own models when it brought them.
 * Extraction can describe page images (VLM enrichment); indexing summarises
 * tables while chunking and, when entity extraction is on, runs NER. Those
 * calls read the scope, so a workspace on its own model sends its documents
 * to its own provider and none to the server's. The stages run in this
 * worker without Inngest steps, so the scope entered here reaches every call.
 *
 * Their model calls count toward the AI allowance of whoever uploaded the
 * source; indexing is never refused or stopped for it.
 */
import type {
    ExtractionJob,
    ExtractionPipelinePort,
    IndexingJob,
} from "@launchstack/orchestration";
import type { LoggerPort } from "@launchstack/runtime";
import { DocIngestionPipeline } from "@launchstack/indexing";

import { uploaderOfVersion, uploaderOrNull } from "~/server/ai-usage/uploader";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";

export function createIngestionPipelinePort(logger: LoggerPort): ExtractionPipelinePort {
    const pipeline = new DocIngestionPipeline(logger);
    return {
        extract: (job: ExtractionJob) => {
            const aiUse = { feature: "ingestion", userId: job.actorId, enforce: false } as const;
            return withWorkspaceChatModels(job.companyId, aiUse, () => pipeline.extract(job));
        },
        index: async (job: IndexingJob) => {
            const userId = await uploaderOrNull(uploaderOfVersion(job.sourceVersionId));
            const aiUse = { feature: "ingestion", userId, enforce: false } as const;
            return withWorkspaceChatModels(job.companyId, aiUse, () => pipeline.index(job));
        },
    };
}
