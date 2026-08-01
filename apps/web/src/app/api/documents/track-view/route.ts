import { NextResponse } from "next/server";
import { db } from "~/server/db/index";
import { users, documentViews, document } from "@launchstack/core/db/schema";
import { eq } from "drizzle-orm";
import { validateRequestBody, TrackDocumentViewSchema } from "~/lib/validation";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

export async function POST(request: Request) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const validation = await validateRequestBody(request, TrackDocumentViewSchema);
        if (!validation.success) return validation.response;
        const { documentId } = validation.data;

        // Verify document exists and belongs to the same company
        const [doc] = await db
            .select()
            .from(document)
            .where(eq(document.id, documentId));

        if (!doc) {
            return NextResponse.json(
                { success: false, error: "Document not found" },
                { status: 404 }
            );
        }

        if (doc.companyId !== ctx.data.companyId) {
            return NextResponse.json(
                { success: false, error: "Unauthorized to view this document" },
                { status: 403 }
            );
        }

        // Record the document view
        await db.insert(documentViews).values({
            documentId: BigInt(documentId),
            userId: ctx.data.clerkUserId,
            companyId: ctx.data.companyId,
        });

        // Update user's last active time
        await db
            .update(users)
            .set({ lastActiveAt: new Date() })
            .where(eq(users.userId, ctx.data.clerkUserId));

        return NextResponse.json(
            { success: true, message: "View tracked successfully" },
            { status: 200 }
        );
    } catch (error: unknown) {
        console.error("Error tracking document view:", error);
        return NextResponse.json(
            { success: false, error: "Unable to track document view" },
            { status: 500 }
        );
    }
}
