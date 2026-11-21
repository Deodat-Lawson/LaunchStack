/**
 * Re-embed a source: read the file it already has again, chunk it and embed
 * it with the workspace's current embedding model.
 *
 * Retry (`retrySourceProcessing`) revives a FAILED run. This is for a file
 * that processed fine but should be read again — the embedding model
 * changed, extraction improved, or the answers it gives look wrong.
 *
 * It is a new version of the same stored file, not a rerun of the current
 * one. Indexing inserts chunks and never deletes them, so running the
 * current version again would store every chunk twice; a version is the
 * unit the pipeline already knows how to replace. The old version's chunks
 * stay, as they do for an uploaded version, so citations in earlier answers
 * still resolve, and notes move across by the usual rehydration.
 *
 * A recording is never embedded — its transcript is — so re-embedding a
 * recording re-embeds the transcript made from it.
 */

import { and, desc, eq, sql, type SQL } from "drizzle-orm";

import { isZipFile } from "@launchstack/conversion/archive-expansion";
import { resolveIngestIndexKey } from "@launchstack/llm/embeddings";
import { getOcrConfig } from "@launchstack/conversion/ocr/config";
import {
    buildInternalFileUrl,
    isInternalFileUrl,
    parseInternalFileId,
} from "@launchstack/store/crypto";
import { document, documentVersions, ocrJobs } from "@launchstack/store/schema";
import { mediaKindOfMime, mediaKindOfName } from "~/lib/media-document";
import { db } from "~/server/db";
import { createDocumentVersionLifecycle } from "~/server/services/document-creation";

/** The columns re-embedding reads off a document row. */
const targetColumns = {
    id: document.id,
    companyId: document.companyId,
    title: document.title,
    category: document.category,
    url: document.url,
    mimeType: document.mimeType,
    fileType: document.fileType,
    ocrEnabled: document.ocrEnabled,
    ocrJobId: document.ocrJobId,
    creationKey: document.creationKey,
    currentVersionId: document.currentVersionId,
};

export type ReembedTarget = {
    id: number;
    companyId: bigint;
    title: string;
    category: string;
    url: string;
    mimeType: string | null;
    fileType: string | null;
    ocrEnabled: boolean | null;
    ocrJobId: string | null;
    creationKey: string | null;
    currentVersionId: bigint | null;
};

export type ReembedResult =
    | {
          status: "reembedding";
          /** The document that is being processed — the transcript, for a recording. */
          documentId: number;
          versionId: number;
          versionNumber: number;
          jobId: string;
      }
    /** A run of this file is queued or in progress. */
    | { status: "already_running" }
    /** Nothing stored to read again: a recording with no transcript, a row with no file type. */
    | { status: "no_file" }
    /** An archive is expanded into its own files; those are what get embedded. */
    | { status: "archive" };

/** Routing the first run was given, persisted on its job. */
interface StoredDispatchOptions {
    preferredProvider?: string;
    originalFilename?: string;
    isWebsite?: boolean;
    transcriptionMetadata?: Record<string, unknown>;
}

/** A stored recording kept for playback; its transcript is a separate document. */
export function isRecording(
    doc: Pick<ReembedTarget, "creationKey" | "ocrEnabled" | "mimeType" | "title" | "url">
) {
    if (doc.creationKey?.endsWith(":audio-source")) return true;
    return (
        doc.ocrEnabled === false &&
        (mediaKindOfMime(doc.mimeType) ??
            mediaKindOfName(doc.title) ??
            mediaKindOfName(doc.url)) !== null
    );
}

/**
 * The document whose text gets embedded: the document itself, or — for a
 * recording — the transcript made from it, within the caller's scope.
 * Null when a recording has no transcript the caller can see.
 */
export async function findReembedTarget(
    doc: ReembedTarget,
    inScope: SQL | undefined
): Promise<ReembedTarget | null> {
    if (!isRecording(doc)) return doc;
    const [transcript] = await db
        .select(targetColumns)
        .from(document)
        .where(
            and(
                inScope,
                sql`${document.ocrMetadata}->>'source' = 'transcription'`,
                sql`${document.ocrMetadata}->>'audioDocumentId' = ${String(doc.id)}`
            )
        )
        .orderBy(desc(document.id))
        .limit(1);
    return transcript ?? null;
}

/** Load a document row by id with the columns re-embedding needs. */
export async function loadReembedDocument(
    documentId: number,
    inScope: SQL | undefined
): Promise<ReembedTarget | null> {
    const [doc] = await db
        .select(targetColumns)
        .from(document)
        .where(and(eq(document.id, documentId), inScope));
    return doc ?? null;
}

/**
 * Start a fresh run of `target`'s current file as a new version. Repeated
 * clicks while that version is current converge on it (the creation key
 * names the version being re-read), and a run already under way is left
 * alone.
 */
export async function reembedDocument(params: {
    target: ReembedTarget;
    userId: string;
}): Promise<ReembedResult> {
    const { target, userId } = params;

    let version:
        | {
              id: number;
              url: string;
              mimeType: string;
              fileSize: bigint | null;
              ocrJobId: string | null;
          }
        | undefined;
    if (target.currentVersionId !== null) {
        [version] = await db
            .select({
                id: documentVersions.id,
                url: documentVersions.url,
                mimeType: documentVersions.mimeType,
                fileSize: documentVersions.fileSize,
                ocrJobId: documentVersions.ocrJobId,
            })
            .from(documentVersions)
            .where(
                and(
                    eq(documentVersions.id, Number(target.currentVersionId)),
                    eq(documentVersions.documentId, BigInt(target.id))
                )
            )
            .limit(1);
    }

    // The current version's job, or a legacy unversioned row's own.
    const jobId = version ? version.ocrJobId : target.ocrJobId;
    const [job] = jobId
        ? await db
              .select({
                  status: ocrJobs.status,
                  documentUrl: ocrJobs.documentUrl,
                  dispatchOptions: ocrJobs.dispatchOptions,
              })
              .from(ocrJobs)
              .where(eq(ocrJobs.id, jobId))
              .limit(1)
        : [];
    if (job && (job.status === "queued" || job.status === "processing")) {
        return { status: "already_running" };
    }

    const mimeType = version?.mimeType ?? target.fileType ?? target.mimeType;
    if (!mimeType) return { status: "no_file" };

    const options = (job?.dispatchOptions as StoredDispatchOptions | null) ?? {};
    if (isZipFile(mimeType, options.originalFilename ?? target.title)) {
        return { status: "archive" };
    }

    const url = version?.url ?? target.url;
    const origin = getOcrConfig().appPublicUrl ?? "http://app:3000";
    const fileId = parseInternalFileId(url);
    // A relative file reference survives deployment-origin changes and legacy
    // versions with no prior job. Only the worker URL needs the current origin.
    const processingUrl =
        fileId !== null && isInternalFileUrl(url, origin)
            ? buildInternalFileUrl(origin, fileId)
            : (job?.documentUrl ?? url);
    const lifecycle = await createDocumentVersionLifecycle({
        documentId: target.id,
        companyId: target.companyId,
        userId,
        title: target.title,
        category: target.category,
        url,
        processingUrl,
        creationKey: `reembed:${target.id}:${version?.id ?? "legacy"}`,
        mimeType,
        fileSize: version?.fileSize ?? null,
        preferredProvider: options.preferredProvider,
        originalFilename: options.originalFilename,
        isWebsite: options.isWebsite,
        transcriptionMetadata: options.transcriptionMetadata,
        // Whatever the workspace embeds with now — the point of re-embedding
        // after a model change — not the index the first run was pinned to.
        embeddingIndexKey: (await resolveIngestIndexKey(target.companyId)) ?? undefined,
    });

    return {
        status: "reembedding",
        documentId: target.id,
        versionId: lifecycle.version.id,
        versionNumber: lifecycle.version.versionNumber,
        jobId: lifecycle.job.id,
    };
}
