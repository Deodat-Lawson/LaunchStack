/**
 * `save_conversation`: an assistant's conversation becomes a Conversation
 * source in the workspace.
 *
 * First save — the publish pattern (repo-explainer, mindmaps): render to
 * Markdown, store the file, `processDocumentUpload` with the conversation
 * marker in `ocrMetadata` (the viewer keys off it), then `recordUpload`,
 * which applies ADR-014's defaults for a file a person added. The file goes
 * to Unfiled, so it starts private to the saver: a restricted
 * `document_settings` row plus their manage grant. (The connector-sink path
 * would skip those defaults — it adds files for the workspace, not a person.)
 *
 * Re-save with `conversationId` — a new *version* of the same document
 * (`createDocumentVersionLifecycle`, as a mindmap's later publish does), so
 * citations, notes and the link keep pointing at one source. Only the person
 * who saved a conversation can update it; an identical transcript is a no-op.
 *
 * After each save that changed something, the follow-up note is written
 * after the response (`./follow-up`).
 */
import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { getOcrConfig } from "@launchstack/conversion/ocr/config";
import { buildInternalFileUrl } from "@launchstack/store/crypto";
import { document } from "@launchstack/store/schema";

import { UNFILED_FOLDER } from "~/lib/folders/path";
import { ASSISTANT_CONVERSATIONS_CONNECTOR, ASSISTANT_LABELS } from "~/lib/session-transcript";
import { uploadFile } from "~/lib/storage";
import { db } from "~/server/db";
import { assistantConversations, type AssistantClient } from "~/server/db/schema";
import { getEngine } from "~/server/engine";
import { MCP_SCOPE_WRITE } from "~/server/mcp/config";
import type { McpPrincipal } from "~/server/mcp/principal";
import { createDocumentVersionLifecycle } from "~/server/services/document-creation";
import { processDocumentUpload, toAbsoluteUrl } from "~/server/services/document-upload";
import {
    DOCUMENT_EDIT_DENIED,
    FOLDER_EDIT_DENIED,
    canEditFolder,
} from "~/server/services/folder-access";
import { authorizeInternalFileRef } from "~/server/services/internal-file-ref";
import { recordUpload } from "~/server/workspace/added-documents";
import { canEditDocument } from "~/server/workspace/item-access";

import { runAfterResponse } from "./after-response";
import { writeFollowUp } from "./follow-up";
import { followUpModelUnavailable } from "./follow-up-model";
import {
    assertTranscriptSize,
    conversationContentHash,
    conversationFilename,
    renderConversationMarkdown,
} from "./render";
import {
    ConversationSaveError,
    type SaveConversationInput,
    type SaveConversationResult,
} from "./types";
import { CONVERSATION_LIMITS, normalizeConversationInput, oneLine } from "./validate";
import type { NormalizedConversation } from "./validate";

type SaveRequest = SaveConversationInput & { principal: McpPrincipal; origin: string };
type Ctx = McpPrincipal["ctx"];

/** The canonical deep link: the workspace opens `?source=d<id>` as a tab. */
export function conversationUrl(origin: string, documentId: number): string {
    return `${origin.replace(/\/+$/, "")}/employer/documents?source=d${documentId}`;
}

/** Everything one save needs, worked out once. */
interface PreparedSave {
    ctx: Ctx;
    origin: string;
    conversation: NormalizedConversation;
    family: AssistantClient;
    clientName: string | null;
    savedAt: Date;
    markdown: string;
    contentHash: string;
}

function documentMetadata(save: PreparedSave): Record<string, unknown> {
    return {
        connector: ASSISTANT_CONVERSATIONS_CONNECTOR,
        assistant: save.family,
        clientName: save.clientName,
        model: save.conversation.model,
        contentHash: save.contentHash,
        savedAt: save.savedAt.toISOString(),
        messageCount: save.conversation.messages.length,
    };
}

/**
 * Queue the follow-up for this save, or say why there will be none. The row
 * already carries the matching status (`pending` or `skipped`).
 */
function queueFollowUp(
    save: PreparedSave,
    rowId: number,
    documentId: number,
    skipReason: string | null
): "queued" | "skipped" {
    if (skipReason) return "skipped";
    const { ctx } = save;
    runAfterResponse(`follow-up for conversation ${documentId}`, () =>
        writeFollowUp({
            conversationRowId: rowId,
            documentId,
            companyId: ctx.companyId,
            authUserId: ctx.authUserId,
            title: save.conversation.title,
            family: save.family,
            contentHash: save.contentHash,
            messages: save.conversation.messages,
            documentScope: () => ctx.documentScope(),
        })
    );
    return "queued";
}

async function createConversation(save: PreparedSave): Promise<SaveConversationResult> {
    const { ctx, conversation } = save;
    // Unfiled, like any first publish: private to the saver until they share it.
    if (!(await canEditFolder(ctx, UNFILED_FOLDER))) {
        throw new ConversationSaveError("forbidden", FOLDER_EDIT_DENIED);
    }

    const filename = conversationFilename(conversation.title);
    const stored = await uploadFile({
        filename,
        data: Buffer.from(save.markdown, "utf8"),
        contentType: "text/markdown",
        userId: ctx.authUserId,
        companyId: ctx.companyId,
    });
    const upload = await processDocumentUpload({
        user: { userId: ctx.authUserId, companyId: ctx.companyId },
        documentName: conversation.title,
        rawDocumentUrl: stored.url,
        requestUrl: save.origin,
        // Every first save is its own source; re-saves name it by id.
        creationKey: `assistant-conversation:${ctx.userPk}:${randomUUID()}`,
        explicitStorageType: stored.provider,
        mimeType: "text/markdown",
        originalFilename: filename,
        ocrMetadata: documentMetadata(save),
    });
    await recordUpload(ctx, upload);
    const documentId = upload.document.id;

    const skipReason = followUpModelUnavailable();
    const [row] = await db
        .insert(assistantConversations)
        .values({
            companyId: ctx.companyId,
            documentId: BigInt(documentId),
            savedByUserId: ctx.userPk,
            client: save.family,
            clientName: save.clientName,
            title: conversation.title,
            contentHash: save.contentHash,
            messageCount: conversation.messages.length,
            followUpStatus: skipReason ? "skipped" : "pending",
            followUpError: skipReason,
        })
        .returning({ id: assistantConversations.id });
    if (!row) throw new Error(`Conversation ${documentId} was stored but not recorded`);

    return {
        conversationId: documentId,
        status: "created",
        title: conversation.title,
        url: conversationUrl(save.origin, documentId),
        followUp: queueFollowUp(save, row.id, documentId, skipReason),
    };
}

async function updateConversation(
    save: PreparedSave,
    documentId: number
): Promise<SaveConversationResult> {
    const { ctx, conversation } = save;
    const notFound = new ConversationSaveError(
        "not_found",
        `No conversation ${documentId} that you saved exists in this workspace. Save without conversationId to create a new one.`
    );

    // Only the person who saved a conversation can add to it.
    const [row] = await db
        .select()
        .from(assistantConversations)
        .where(
            and(
                eq(assistantConversations.companyId, ctx.companyId),
                eq(assistantConversations.documentId, BigInt(documentId)),
                eq(assistantConversations.savedByUserId, ctx.userPk)
            )
        )
        .limit(1);
    if (!row) throw notFound;

    const [doc] = await db
        .select({ id: document.id, category: document.category })
        .from(document)
        .where(and(eq(document.id, documentId), eq(document.companyId, ctx.companyId)))
        .limit(1);
    if (!doc) throw notFound;
    // A new version replaces the source's content, which takes edit access to it.
    if (!(await canEditDocument(ctx, { id: doc.id, category: doc.category }))) {
        throw new ConversationSaveError("forbidden", DOCUMENT_EDIT_DENIED);
    }

    if (row.contentHash === save.contentHash) {
        return {
            conversationId: documentId,
            status: "unchanged",
            title: row.title,
            url: conversationUrl(save.origin, documentId),
            followUp: "unchanged",
        };
    }

    const filename = conversationFilename(conversation.title);
    const stored = await uploadFile({
        filename,
        data: Buffer.from(save.markdown, "utf8"),
        contentType: "text/markdown",
        userId: ctx.authUserId,
        companyId: ctx.companyId,
    });

    // Same cold-start ordering as processDocumentUpload: configure the engine
    // before reading provider config or authorising file refs.
    getEngine();
    const internalFileId = await authorizeInternalFileRef(
        stored.url,
        ctx.companyId,
        getOcrConfig().defaultProvider
    );
    const processingUrl =
        internalFileId !== null
            ? buildInternalFileUrl(getOcrConfig().appPublicUrl ?? save.origin, internalFileId)
            : toAbsoluteUrl(stored.url, save.origin);

    const label = ASSISTANT_LABELS[save.family];
    await createDocumentVersionLifecycle({
        documentId,
        companyId: ctx.companyId,
        userId: ctx.authUserId,
        title: conversation.title,
        category: doc.category,
        url: stored.url,
        processingUrl,
        // One version per save. Content-keyed would converge an A→B→A→B
        // sequence on B's first version and leave the document showing A.
        creationKey: `assistant-conversation:${documentId}:${save.contentHash}:${randomUUID()}`,
        mimeType: "text/markdown",
        fileSize: Buffer.byteLength(save.markdown, "utf8"),
        changelog: `Saved again from ${label}${save.clientName && save.clientName !== label ? ` (${save.clientName})` : ""}`,
        originalFilename: filename,
    });

    // A version carries no metadata or title of its own: the document row is
    // where the viewer and the library read them.
    await db
        .update(document)
        .set({
            title: conversation.title,
            ocrMetadata: sql`COALESCE(${document.ocrMetadata}, '{}'::jsonb) || ${JSON.stringify(documentMetadata(save))}::jsonb`,
        })
        .where(and(eq(document.id, documentId), eq(document.companyId, ctx.companyId)));

    const skipReason = followUpModelUnavailable();
    await db
        .update(assistantConversations)
        .set({
            client: save.family,
            clientName: save.clientName,
            title: conversation.title,
            contentHash: save.contentHash,
            messageCount: conversation.messages.length,
            followUpStatus: skipReason ? "skipped" : "pending",
            followUpError: skipReason,
        })
        .where(eq(assistantConversations.id, row.id));

    return {
        conversationId: documentId,
        status: "updated",
        title: conversation.title,
        url: conversationUrl(save.origin, documentId),
        followUp: queueFollowUp(save, row.id, documentId, skipReason),
    };
}

/**
 * An identical transcript this person already saved, so a retried or
 * repeated first save points at the existing source instead of adding a
 * second copy.
 */
async function findIdenticalConversation(ctx: Ctx, contentHash: string) {
    const [row] = await db
        .select({
            documentId: assistantConversations.documentId,
            title: assistantConversations.title,
        })
        .from(assistantConversations)
        .where(
            and(
                eq(assistantConversations.companyId, ctx.companyId),
                eq(assistantConversations.savedByUserId, ctx.userPk),
                eq(assistantConversations.contentHash, contentHash)
            )
        )
        .limit(1);
    return row ?? null;
}

export async function saveAssistantConversation(
    request: SaveRequest
): Promise<SaveConversationResult> {
    const { principal, origin } = request;
    const { ctx } = principal;

    if (!principal.scopes.has(MCP_SCOPE_WRITE)) {
        throw new ConversationSaveError(
            "forbidden",
            "This connection can read the workspace but not save to it. Reconnect LaunchStack with write access."
        );
    }
    if (!ctx.can("documents.upload")) {
        throw new ConversationSaveError(
            "forbidden",
            "Your role in this workspace cannot add files, so conversations cannot be saved here. Ask a workspace admin for upload access."
        );
    }

    const conversation = normalizeConversationInput(request);
    const family = conversation.assistant ?? principal.family;
    const clientName = oneLine(principal.label, CONVERSATION_LIMITS.clientNameChars);
    const savedAt = new Date();
    const markdown = renderConversationMarkdown(conversation, {
        family,
        clientName,
        model: conversation.model,
        savedAt,
    });
    assertTranscriptSize(markdown);

    const save: PreparedSave = {
        ctx,
        origin,
        conversation,
        family,
        clientName,
        savedAt,
        markdown,
        contentHash: conversationContentHash(conversation),
    };

    if (conversation.conversationId !== null) {
        return updateConversation(save, conversation.conversationId);
    }
    const identical = await findIdenticalConversation(ctx, save.contentHash);
    if (identical) {
        const documentId = Number(identical.documentId);
        return {
            conversationId: documentId,
            status: "unchanged",
            title: identical.title,
            url: conversationUrl(origin, documentId),
            followUp: "unchanged",
        };
    }
    return createConversation(save);
}
