import { NextResponse } from 'next/server';
import { db } from "../../../server/db/index";
import { document, ChatHistory, documentReferenceResolution, documentSections, documentStructure, documentMetadata, documentPreviews, workspaceResults, users } from "../../../server/db/schema";
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

        // Delete related data in proper order to maintain referential integrity
        await db.delete(ChatHistory).where(eq(ChatHistory.documentId, BigInt(docId)));
        await db.delete(documentReferenceResolution).where(
            eq(documentReferenceResolution.resolvedInDocumentId, documentId)
        );

        // Delete RLM schema tables (documentSections, documentStructure, documentMetadata, etc.)
        await db.delete(workspaceResults).where(eq(workspaceResults.documentId, BigInt(documentId)));
        await db.delete(documentPreviews).where(eq(documentPreviews.documentId, BigInt(documentId)));
        await db.delete(documentSections).where(eq(documentSections.documentId, BigInt(documentId)));
        await db.delete(documentStructure).where(eq(documentStructure.documentId, BigInt(documentId)));
        await db.delete(documentMetadata).where(eq(documentMetadata.documentId, BigInt(documentId)));
        console.log(`Deleted RLM data for document ${documentId}`);

        // Finally delete the document itself
        await db.delete(document).where(eq(document.id, documentId));

        return NextResponse.json({ 
            success: true, 
            message: 'Document and all related data deleted successfully' 
        }, { status: 200 });
    } catch (error) {
        console.error('Error deleting document:', error);
        return NextResponse.json({ 
            error: 'Error deleting document and related data',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}