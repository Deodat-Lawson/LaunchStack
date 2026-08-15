/**
 * SourceLifecyclePort implementation over the moved lifecycle functions.
 * Translates application commands into the (legacy-shaped) lifecycle params;
 * array creation keys serialize to JSON, matching the archive-entry callers.
 */
import type {
    CreateSourceCommand,
    CreateSourceVersionCommand,
    SourceLifecyclePort,
    SourceLifecycleResult,
} from "@launchstack/application";

import { createDocumentLifecycle, createDocumentVersionLifecycle } from "./source-lifecycle";

function serializeCreationKey(key: string | string[]): string {
    return typeof key === "string" ? key : JSON.stringify(key);
}

export class DrizzleSourceLifecycle implements SourceLifecyclePort {
    async createSource(cmd: CreateSourceCommand): Promise<SourceLifecycleResult> {
        const result = await createDocumentLifecycle({
            companyId: BigInt(cmd.actor.companyId),
            userId: cmd.actor.actorId,
            title: cmd.documentName,
            category: cmd.category,
            url: cmd.documentUrl,
            creationKey: serializeCreationKey(cmd.creationKey),
            mimeType: cmd.options.mimeType ?? null,
            traceId: cmd.traceId,
            processing: cmd.options.skipProcessing
                ? undefined
                : {
                      preferredProvider: cmd.options.preferredProvider,
                      originalFilename: cmd.options.originalFilename,
                      isWebsite: cmd.options.isWebsite,
                      transcriptionMetadata: cmd.options.transcriptionMetadata,
                      embeddingIndexKey: cmd.options.embeddingIndexKey,
                  },
        });
        return {
            sourceId: result.documentId,
            sourceVersionId: result.versionId,
            versionNumber: result.version.versionNumber,
            ocrJobId: result.jobId,
        };
    }

    async createSourceVersion(cmd: CreateSourceVersionCommand): Promise<SourceLifecycleResult> {
        const result = await createDocumentVersionLifecycle({
            documentId: cmd.sourceId,
            companyId: BigInt(cmd.actor.companyId),
            userId: cmd.actor.actorId,
            title: cmd.options.originalFilename ?? String(cmd.sourceId),
            category: "",
            url: cmd.documentUrl,
            creationKey: serializeCreationKey(cmd.creationKey),
            mimeType: cmd.options.mimeType ?? "application/octet-stream",
            fileSize: cmd.fileSize,
            changelog: cmd.changelog,
            preferredProvider: cmd.options.preferredProvider,
            originalFilename: cmd.options.originalFilename,
            isWebsite: cmd.options.isWebsite,
            transcriptionMetadata: cmd.options.transcriptionMetadata,
            embeddingIndexKey: cmd.options.embeddingIndexKey,
            traceId: cmd.traceId,
        });
        return {
            sourceId: result.documentId,
            sourceVersionId: result.versionId,
            versionNumber: result.version.versionNumber,
            ocrJobId: result.jobId,
        };
    }
}
