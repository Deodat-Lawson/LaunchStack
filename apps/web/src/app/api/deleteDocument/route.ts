import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "../../../server/db/index";
import { document } from "@launchstack/store/schema";
import { validateRequestBody, DeleteDocumentSchema } from "~/lib/validation";
import { deleteDocumentBlobs, deleteDocumentCore } from "~/server/services/document-delete";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import { recordAuditEvent } from "~/lib/authz/audit";
import { callNotesCalls } from "@launchstack/pipelines/call-notes";
import {
    CALL_NOTE_DOCUMENT_MANAGED_MESSAGE,
    callNoteDocumentReference,
    isCallNoteDocument,
} from "~/lib/call-note-document";

export async function DELETE(request: Request) {
    try {
        const validation = await validateRequestBody(request, DeleteDocumentSchema);
        if (!validation.success) {
            return validation.response;
        }

        const ctx = await requireWorkspacePermission("documents.delete");
        if (!ctx.success) return ctx.response;

        const { docId } = validation.data;
        const documentId = Number(docId);

        if (isNaN(documentId) || documentId <= 0) {
            return NextResponse.json(
                { success: false, error: "Invalid document ID format" },
                { status: 400 }
            );
        }

        // A document the caller cannot see is one they cannot delete, and it
        // reads exactly like one that does not exist.
        const [doc] = await db
            .select({
                id: document.id,
                title: document.title,
                category: document.category,
                ocrMetadata: document.ocrMetadata,
                indexedCallNote: callNoteDocumentReference(document, callNotesCalls),
            })
            .from(document)
            .where(
                and(
                    eq(document.id, documentId),
                    scopedDocumentWhere(ctx.data.companyId, await ctx.data.documentScope())
                )
            );

        if (!doc) {
            return NextResponse.json(
                { success: false, error: "Document not found" },
                { status: 404 }
            );
        }

        if (isCallNoteDocument(doc)) {
            return NextResponse.json(
                { success: false, error: CALL_NOTE_DOCUMENT_MANAGED_MESSAGE },
                { status: 409 }
            );
        }

        const blobDeletions = await db.transaction(async tx => {
            const pendingBlobs = await deleteDocumentCore(tx, documentId);
            await recordAuditEvent(tx, {
                companyId: ctx.data.companyId,
                actorUserId: ctx.data.authUserId,
                action: "document.deleted",
                targetType: "document",
                targetId: documentId,
                detail: { title: doc.title, category: doc.category },
            });
            return pendingBlobs;
        });
        await deleteDocumentBlobs(blobDeletions);

        return NextResponse.json(
            {
                success: true,
                message: "Document and all related data deleted successfully",
            },
            { status: 200 }
        );
    } catch (error) {
        console.error("Error deleting document:", error);
        return NextResponse.json(
            { success: false, error: "Failed to delete document" },
            { status: 500 }
        );
    }
}
