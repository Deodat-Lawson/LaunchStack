import { NextResponse } from "next/server";
import { db } from "~/server/db/index";
import { document } from "@launchstack/store/schema";
import { users, documentViews } from "~/server/db/schema";
import { and, eq } from "drizzle-orm";
import { validateRequestBody, TrackDocumentViewSchema } from "~/lib/validation";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

export async function POST(request: Request) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const validation = await validateRequestBody(request, TrackDocumentViewSchema);
        if (!validation.success) return validation.response;
        const { documentId } = validation.data;

        // Scoped in the WHERE clause on purpose: a separate 403 for documents
        // that exist in another tenant would confirm their ids.
        const [doc] = await db
            .select({ id: document.id })
            .from(document)
            .where(and(eq(document.id, documentId), eq(document.companyId, ctx.data.companyId)));

        if (!doc) {
            return NextResponse.json(
                { success: false, error: "Document not found" },
                { status: 404 }
            );
        }

        // Record the document view
        await db.insert(documentViews).values({
            documentId: BigInt(documentId),
            userId: ctx.data.authUserId,
            companyId: ctx.data.companyId,
        });

        // Update user's last active time
        await db
            .update(users)
            .set({ lastActiveAt: new Date() })
            .where(eq(users.userId, ctx.data.authUserId));

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
