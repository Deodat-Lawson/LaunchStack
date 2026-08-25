import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "../../../server/db/index";
import { document } from "@launchstack/store/schema";
import { validateRequestBody, DeleteDocumentSchema } from "~/lib/validation";
import { deleteDocumentCore } from "~/server/services/document-delete";
import { isManagementRole, requireWorkspaceContext } from "~/lib/require-workspace-context";

export async function DELETE(request: Request) {
    try {
        const validation = await validateRequestBody(request, DeleteDocumentSchema);
        if (!validation.success) {
            return validation.response;
        }

        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        if (!isManagementRole(ctx.data.role)) {
            return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 403 });
        }

        const { docId } = validation.data;
        const documentId = Number(docId);

        if (isNaN(documentId) || documentId <= 0) {
            return NextResponse.json(
                { success: false, error: "Invalid document ID format" },
                { status: 400 }
            );
        }

        const [doc] = await db
            .select({ id: document.id, companyId: document.companyId })
            .from(document)
            .where(eq(document.id, documentId));

        if (!doc || doc.companyId !== ctx.data.companyId) {
            return NextResponse.json(
                { success: false, error: "Document not found" },
                { status: 404 }
            );
        }

        await db.transaction(async tx => {
            await deleteDocumentCore(tx, documentId);
        });

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
