import { NextResponse } from 'next/server';
import { db } from "../../../server/db/index";
import { document, ChatHistory, documentReferenceResolution, documentSections, documentRetrievalChunks, documentStructure, documentMetadata, documentPreviews, documentViews, predictiveDocumentAnalysisResults, workspaceResults, users, kgEntityMentions } from "@launchstack/core/db/schema";
import { eq } from "drizzle-orm";
import { validateRequestBody, DeleteDocumentSchema } from "~/lib/validation";
import { auth } from "@clerk/nextjs/server";

export async function DELETE(request: Request) {
    try {
        const validation = await validateRequestBody(request, DeleteDocumentSchema);
        if (!validation.success) {
            return validation.response;
        }

        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({
                success: false,
                message: "Invalid user."
            }, { status: 401 });
        }

        const [userInfo] = await db
            .select()
            .from(users)
            .where(eq(users.userId, userId));

        if (!userInfo) {
            return NextResponse.json({
                success: false,
                message: "Invalid user."
            }, { status: 401 });
        } else if (userInfo.role !== "employer" && userInfo.role !== "owner") {
            return NextResponse.json({
                success: false,
                message: "Unauthorized"
            }, { status: 401 });
        }

        const { docId } = validation.data;
        const documentId = Number(docId);

        if (isNaN(documentId) || documentId <= 0) {
            return NextResponse.json({
                success: false,
                error: "Invalid document ID format"
            }, { status: 400 });
        }

        // All deletes in a single transaction — if any step fails, nothing is partially deleted
        await db.transaction(async (tx) => {
            await tx.delete(ChatHistory).where(eq(ChatHistory.documentId, BigInt(docId)));
            await tx.delete(documentReferenceResolution).where(
                eq(documentReferenceResolution.resolvedInDocumentId, documentId)
            );
            await tx.delete(predictiveDocumentAnalysisResults).where(eq(predictiveDocumentAnalysisResults.documentId, BigInt(documentId)));
            await tx.delete(documentViews).where(eq(documentViews.documentId, BigInt(documentId)));

            // Delete RLM schema tables — order matters for FK constraints:
            // kgEntityMentions & workspaceResults & documentPreviews reference documentSections (contextChunks),
            // documentRetrievalChunks references both documentSections and document.
            await tx.delete(kgEntityMentions).where(eq(kgEntityMentions.documentId, BigInt(documentId)));
            await tx.delete(workspaceResults).where(eq(workspaceResults.documentId, BigInt(documentId)));
            await tx.delete(documentPreviews).where(eq(documentPreviews.documentId, BigInt(documentId)));
            await tx.delete(documentRetrievalChunks).where(eq(documentRetrievalChunks.documentId, BigInt(documentId)));
            await tx.delete(documentSections).where(eq(documentSections.documentId, BigInt(documentId)));
            await tx.delete(documentStructure).where(eq(documentStructure.documentId, BigInt(documentId)));
            await tx.delete(documentMetadata).where(eq(documentMetadata.documentId, BigInt(documentId)));

            // Finally delete the document itself
            await tx.delete(document).where(eq(document.id, documentId));
        });

        return NextResponse.json({
            success: true,
            message: 'Document and all related data deleted successfully'
        }, { status: 200 });
    } catch (error) {
        console.error('Error deleting document:', error);
        return NextResponse.json({
            success: false,
            error: 'Failed to delete document'
        }, { status: 500 });
    }
}