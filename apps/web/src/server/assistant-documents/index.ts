/**
 * Filing what an assistant hands over (`add_document`) into the workspace as
 * a Source.
 *
 * Choosing a folder is choosing who can see the file (ADR-014): a loose file
 * (Unfiled) starts private to whoever added it, and a filed one takes its
 * folder's audience. So the questions an assistant asks before filing are
 * where it goes and, when a document of the same name is already there,
 * whether this is a new version of it. This module answers both questions
 * (the folders a person may add to, each with its audience in words; the
 * same-title documents in a folder) and does the filing: the same publish
 * path `save_conversation` uses (`uploadFile` → `processDocumentUpload` →
 * `recordUpload`), or a new version of an existing document.
 *
 * The bytes are already stored when filing starts (`~/server/mcp/staging`);
 * the document points at them. A staged row is claimed before anything is
 * made, so it can be filed once.
 */
import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { getOcrConfig } from "@launchstack/conversion/ocr/config";
import { buildInternalFileUrl } from "@launchstack/store/crypto";
import { document } from "@launchstack/store/schema";

import type { ArtifactType } from "~/lib/artifact-content";
import { artifactDocumentMarker } from "~/lib/artifact-document";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import {
    UNFILED_FOLDER,
    folderPathIssue,
    type FolderPathIssue,
    isUnfiledFolder,
    normalizeFolderPath,
} from "~/lib/folders/path";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { db } from "~/server/db";
import type { McpStagedFile } from "~/server/db/schema";
import { getEngine } from "~/server/engine";
import { FolderError, listFolders, listVisibleFolders } from "~/server/folders";
import { claimStagedFile, recordStagedDocument, releaseStagedFile } from "~/server/mcp/staging";
import { createDocumentVersionLifecycle } from "~/server/services/document-creation";
import {
    UploadRefusedError,
    processDocumentUpload,
    toAbsoluteUrl,
} from "~/server/services/document-upload";
import {
    DOCUMENT_EDIT_DENIED,
    FOLDER_EDIT_DENIED,
    canEditFolder,
} from "~/server/services/folder-access";
import { authorizeInternalFileRef } from "~/server/services/internal-file-ref";
import { UploadAuthorizationError } from "~/server/services/upload-authorization-error";
import { recordUpload } from "~/server/workspace/added-documents";
import { createFolderAs } from "~/server/workspace/folder-actions";
import { accessSubject, canEditDocument } from "~/server/workspace/item-access";
import type { AccessView } from "~/server/workspace/source-access";

type Ctx = WorkspaceContext;

/** How many folder choices an assistant is offered; a form cannot show hundreds. */
export const MAX_FOLDER_CHOICES = 50;

export class AssistantDocumentError extends Error {
    constructor(
        readonly code: "invalid" | "forbidden" | "not_found" | "used" | "refused",
        message: string
    ) {
        super(message);
        this.name = "AssistantDocumentError";
    }
}

export type Audience = AccessView["audience"];

export interface FolderChoice {
    path: string;
    audience: Audience;
    /** Who can see what lands here, in words: "only you", "everyone in the workspace". */
    whoCanSee: string;
    documentCount: number;
}

/** The canonical deep link: the workspace opens `?source=d<id>` as a tab. */
export function documentLink(origin: string, documentId: number): string {
    return `${origin.replace(/\/+$/, "")}/employer/documents?source=d${documentId}`;
}

export function whoCanSee(access: Pick<AccessView, "audience" | "principalCount">): string {
    if (access.audience === "private") return "only you";
    if (access.audience === "workspace") return "everyone in the workspace";
    const n = access.principalCount;
    return n === 1 ? "you and 1 person or group" : `you and ${n} people or groups`;
}

/**
 * Where this person may add a document: Unfiled (only them) first, then
 * every folder they can edit, by path. At most `MAX_FOLDER_CHOICES`.
 */
export async function listFolderChoices(ctx: Ctx): Promise<FolderChoice[]> {
    const [scope, subject] = await Promise.all([ctx.documentScope(), accessSubject(ctx)]);
    const visible = await listVisibleFolders(ctx.companyId, scope, subject);
    const unfiled = visible.find(folder => isUnfiledFolder(folder.path));
    const editable = visible
        .filter(folder => folder.access.canEdit && !isUnfiledFolder(folder.path))
        .sort((a, b) => a.path.localeCompare(b.path))
        .map(folder => ({
            path: folder.path,
            audience: folder.access.audience,
            whoCanSee: whoCanSee(folder.access),
            documentCount: folder.documentCount,
        }));
    return [
        {
            path: UNFILED_FOLDER,
            audience: "private" as const,
            whoCanSee: "only you",
            documentCount: unfiled?.documentCount ?? 0,
        },
        ...editable,
    ].slice(0, MAX_FOLDER_CHOICES);
}

function describeFolderIssue(issue: FolderPathIssue): string {
    switch (issue.code) {
        case "required":
            return "it is empty";
        case "separator":
            return `a folder name cannot contain "${issue.separator}"`;
        case "nameTooLong":
            return `each folder name must be at most ${issue.max} characters`;
        case "unfiledReserved":
        case "underUnfiled":
            return `"${issue.unfiled}" is reserved`;
        case "tooDeep":
            return `folders go at most ${issue.max} levels deep`;
        case "pathTooLong":
            return `the path must be at most ${issue.max} characters`;
    }
}

export interface Destination {
    path: string;
    /** True when this call created the folder (a new top-level folder is private to its creator). */
    created: boolean;
}

/**
 * The folder a document will be filed in: an existing folder the person can
 * edit, or a new one created now. Refuses a path that is not valid.
 */
export async function resolveDestination(ctx: Ctx, rawFolder: string): Promise<Destination> {
    const asked = normalizeFolderPath(rawFolder);
    if (isUnfiledFolder(asked)) {
        if (!(await canEditFolder(ctx, UNFILED_FOLDER))) {
            throw new AssistantDocumentError("forbidden", FOLDER_EDIT_DENIED);
        }
        return { path: UNFILED_FOLDER, created: false };
    }
    const issue = folderPathIssue(asked);
    if (issue) {
        throw new AssistantDocumentError(
            "invalid",
            `"${rawFolder}" is not a usable folder path (${describeFolderIssue(issue)}). Use a path like "Research" or "Finance/Q3".`
        );
    }
    const exists = (await listFolders(ctx.companyId)).some(folder => folder.path === asked);
    if (exists) {
        if (!(await canEditFolder(ctx, asked))) {
            throw new AssistantDocumentError("forbidden", FOLDER_EDIT_DENIED);
        }
        return { path: asked, created: false };
    }
    try {
        const made = await createFolderAs(ctx, asked);
        return { path: made.path, created: true };
    } catch (error) {
        if (error instanceof FolderError) {
            throw new AssistantDocumentError(
                error.status === 403 ? "forbidden" : "invalid",
                error.message
            );
        }
        throw error;
    }
}

/** Who can see a folder's documents, in words, as this person's rail shows it. */
export async function whoCanSeeFolder(ctx: Ctx, path: string): Promise<string> {
    if (isUnfiledFolder(path)) return "only you";
    const [scope, subject] = await Promise.all([ctx.documentScope(), accessSubject(ctx)]);
    const folder = (await listVisibleFolders(ctx.companyId, scope, subject)).find(
        entry => entry.path === path
    );
    return folder ? whoCanSee(folder.access) : "only you";
}

export interface SameTitleDocument {
    id: number;
    title: string;
}

/** Documents this person can open in `folder` whose title matches `title`, ignoring case. */
export async function findSameTitle(
    ctx: Ctx,
    folder: string,
    title: string
): Promise<SameTitleDocument[]> {
    const rows = await db
        .select({ id: document.id, title: document.title })
        .from(document)
        .where(
            and(
                scopedDocumentWhere(ctx.companyId, await ctx.documentScope()),
                eq(document.category, folder),
                sql`lower(${document.title}) = lower(${title.trim()})`
            )
        )
        .limit(3);
    return rows.map(row => ({ id: Number(row.id), title: row.title }));
}

export interface FileStagedInput {
    staged: McpStagedFile;
    title: string;
    folder: string;
    /** The MIME type ingestion reads the file as (an artifact's file is stored as text/plain). */
    ingestMimeType: string;
    artifact: { type: ArtifactType; sourceUrl: string | null } | null;
    /** What to say where it came from, e.g. "Claude Code". Shown in the version changelog. */
    fromLabel: string;
    /** Add a new version of this document instead of a new one. */
    documentId?: number;
    /** Extra marker fields for `ocrMetadata` (origin, client). */
    metadata: Record<string, unknown>;
}

export interface FiledDocument {
    documentId: number;
    title: string;
    folder: string;
    status: "created" | "version_added";
    url: string;
    whoCanSee: string;
}

function refusalMessage(error: unknown): string | null {
    if (error instanceof UploadRefusedError || error instanceof UploadAuthorizationError) {
        return error.message;
    }
    return null;
}

async function createSource(ctx: Ctx, origin: string, input: FileStagedInput): Promise<number> {
    const { staged } = input;
    const upload = await processDocumentUpload({
        user: { userId: ctx.authUserId, companyId: ctx.companyId },
        documentName: input.title,
        rawDocumentUrl: staged.storageUrl!,
        requestUrl: origin,
        category: input.folder,
        creationKey: `assistant-document:${staged.id}`,
        explicitStorageType: (staged.storageProvider as "s3" | "database" | null) ?? undefined,
        mimeType: input.ingestMimeType,
        originalFilename: staged.filename,
        ocrMetadata: {
            ...input.metadata,
            ...(input.artifact
                ? artifactDocumentMarker({
                      artifactType: input.artifact.type,
                      sourceUrl: input.artifact.sourceUrl,
                  })
                : {}),
        },
    });
    // A loose file starts private to whoever added it; a filed one takes its
    // folder's audience (ADR-014).
    await recordUpload(ctx, upload);
    return upload.document.id;
}

async function addVersion(
    ctx: Ctx,
    origin: string,
    input: FileStagedInput,
    documentId: number
): Promise<{ folder: string }> {
    const notFound = new AssistantDocumentError(
        "not_found",
        `No document ${documentId} that you can open exists in this workspace. Use an id from search or list_sources, or leave documentId out to add a new document.`
    );
    const [doc] = await db
        .select({ id: document.id, category: document.category })
        .from(document)
        .where(
            and(
                eq(document.id, documentId),
                scopedDocumentWhere(ctx.companyId, await ctx.documentScope())
            )
        )
        .limit(1);
    if (!doc) throw notFound;
    if (!(await canEditDocument(ctx, { id: doc.id, category: doc.category }))) {
        throw new AssistantDocumentError("forbidden", DOCUMENT_EDIT_DENIED);
    }
    const { staged } = input;
    // Same cold-start ordering as processDocumentUpload: configure the engine
    // before reading provider config or authorising file refs.
    getEngine();
    const internalFileId = await authorizeInternalFileRef(
        staged.storageUrl!,
        ctx.companyId,
        getOcrConfig().defaultProvider
    );
    const processingUrl =
        internalFileId !== null
            ? buildInternalFileUrl(getOcrConfig().appPublicUrl ?? origin, internalFileId)
            : toAbsoluteUrl(staged.storageUrl!, origin);
    await createDocumentVersionLifecycle({
        documentId,
        companyId: ctx.companyId,
        userId: ctx.authUserId,
        title: input.title,
        category: doc.category,
        url: staged.storageUrl!,
        processingUrl,
        creationKey: `assistant-document:${documentId}:${staged.id}:${randomUUID()}`,
        mimeType: input.ingestMimeType,
        fileSize: staged.sizeBytes ?? 0,
        changelog: `Added from ${input.fromLabel}`,
        originalFilename: staged.filename,
    });
    // The document row is where the viewer reads the title and the artifact
    // marker; a version carries neither.
    await db
        .update(document)
        .set({
            title: input.title,
            ocrMetadata: sql`COALESCE(${document.ocrMetadata}, '{}'::jsonb) || ${JSON.stringify({
                ...input.metadata,
                ...(input.artifact
                    ? artifactDocumentMarker({
                          artifactType: input.artifact.type,
                          sourceUrl: input.artifact.sourceUrl,
                      })
                    : {}),
            })}::jsonb`,
        })
        .where(and(eq(document.id, documentId), eq(document.companyId, ctx.companyId)));
    return { folder: doc.category };
}

/**
 * Files a staged draft or upload as a Source in `folder` (already resolved),
 * or as a new version of `documentId`.
 */
export async function fileStagedDocument(
    ctx: Ctx,
    origin: string,
    input: FileStagedInput
): Promise<FiledDocument> {
    if (!(await claimStagedFile(input.staged.id))) {
        throw new AssistantDocumentError("used", "That draft or upload was already added.");
    }
    try {
        if (input.documentId !== undefined) {
            const { folder } = await addVersion(ctx, origin, input, input.documentId);
            await recordStagedDocument(input.staged.id, input.documentId);
            return {
                documentId: input.documentId,
                title: input.title,
                folder,
                status: "version_added",
                url: documentLink(origin, input.documentId),
                whoCanSee: await whoCanSeeFolder(ctx, folder),
            };
        }
        const documentId = await createSource(ctx, origin, input);
        await recordStagedDocument(input.staged.id, documentId);
        return {
            documentId,
            title: input.title,
            folder: input.folder,
            status: "created",
            url: documentLink(origin, documentId),
            whoCanSee: await whoCanSeeFolder(ctx, input.folder),
        };
    } catch (error) {
        await releaseStagedFile(input.staged.id).catch(() => undefined);
        const refusal = refusalMessage(error);
        if (refusal) throw new AssistantDocumentError("refused", refusal);
        throw error;
    }
}
