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
 */
import type {
    ExtractionJob,
    ExtractionPipelinePort,
    IndexingJob,
} from "@launchstack/orchestration";
import type { LoggerPort } from "@launchstack/runtime";
import { DocIngestionPipeline } from "@launchstack/indexing";

import { withWorkspaceChatModels } from "~/server/workspace-models/scope";

export function createIngestionPipelinePort(logger: LoggerPort): ExtractionPipelinePort {
    const pipeline = new DocIngestionPipeline(logger);
    return {
        extract: (job: ExtractionJob) =>
            withWorkspaceChatModels(job.companyId, "ingestion", () => pipeline.extract(job)),
        index: (job: IndexingJob) =>
            withWorkspaceChatModels(job.companyId, "ingestion", () => pipeline.index(job)),
    };
}
