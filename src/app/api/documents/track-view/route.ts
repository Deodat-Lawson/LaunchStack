import { NextResponse } from "next/server";
import { db } from "~/server/db/index";
import { users, documentViews, document } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { validateRequestBody, TrackDocumentViewSchema } from "~/lib/validation";

export async function POST(request: Request) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json(
                { success: false, error: "Unauthorized" },
                { status: 401 }
            );
        }

        const validation = await validateRequestBody(request, TrackDocumentViewSchema);
        if (!validation.success) return validation.response;
        const { documentId } = validation.data;

        // Get user info
        const [userInfo] = await db
            .select()
            .from(users)
            .where(eq(users.userId, userId));

        if (!userInfo) {
            return NextResponse.json(
                { success: false, error: "User not found" },
                { status: 404 }
            );
        }

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

        if (doc.companyId !== userInfo.companyId) {
            return NextResponse.json(
                { success: false, error: "Unauthorized to view this document" },
                { status: 403 }
            );
        }

        // Record the document view
        await db.insert(documentViews).values({
            documentId: BigInt(documentId),
            userId: userId,
            companyId: userInfo.companyId,
        });

        // Update user's last active time
        await db
            .update(users)
            .set({ lastActiveAt: new Date() })
            .where(eq(users.userId, userId));

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
