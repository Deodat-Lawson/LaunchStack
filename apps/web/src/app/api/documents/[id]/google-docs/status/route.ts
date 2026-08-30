/**
 * GET /api/documents/[id]/google-docs/status — the viewer's state line.
 *
 * Readable by any workspace member (the banner shows on the document for
 * everyone); mutating anything stays management-only in the other routes.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { getActiveGoogleConnection } from "~/server/services/google-drive/connections";
import {
    getDriveLinkForDocument,
    isDriveLinkableDocument,
} from "~/server/services/google-drive/links";

import { authorizeDriveRoute } from "../_shared";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
    const { id: rawId } = await context.params;
    const auth = await authorizeDriveRoute(rawId, { requireManagement: false });
    if (!auth.ok) return auth.response;

    const [connection, link] = await Promise.all([
        getActiveGoogleConnection(auth.data.companyId),
        getDriveLinkForDocument(auth.data.documentId),
    ]);

    let linkedByName: string | null = null;
    if (link?.linkedByUserId != null) {
        const [row] = await db
            .select({ name: users.name })
            .from(users)
            .where(eq(users.id, Number(link.linkedByUserId)))
            .limit(1);
        linkedByName = row?.name ?? null;
    }

    return NextResponse.json({
        success: true,
        enabled: true,
        connected: Boolean(connection),
        connectedAccount: connection?.providerAccountEmail ?? null,
        linkable: isDriveLinkableDocument(
            auth.data.doc.fileType,
            auth.data.doc.mimeType,
            auth.data.doc.title
        ),
        link:
            link && link.status !== "unlinked"
                ? {
                      status: link.status,
                      url: link.driveWebViewLink,
                      linkedBy: linkedByName,
                      lastSyncedAt: link.lastSyncedAt,
                      lastCheckedAt: link.lastCheckedAt,
                      fidelityWarning: link.fidelityWarning,
                      lastError: link.lastError,
                  }
                : null,
    });
}
