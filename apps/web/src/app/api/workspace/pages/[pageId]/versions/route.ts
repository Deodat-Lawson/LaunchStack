import { NextResponse } from "next/server";
import { z } from "zod";

import { validateRequestBody } from "~/lib/validation";
import {
    getPage,
    listVersions,
    serializeVersion,
    snapshotPage,
} from "~/server/workspace/service";
import { getWorkspaceSession } from "~/server/workspace/session";

const SnapshotSchema = z.object({
    label: z.string().max(200).optional(),
});

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ pageId: string }> }
) {
    try {
        const session = await getWorkspaceSession();
        if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { pageId } = await params;
        const versions = await listVersions(session.userId, pageId);

        return NextResponse.json(
            { versions: versions.map((v) => serializeVersion(v)) },
            { status: 200 }
        );
    } catch (error) {
        console.error("[workspace/pages/:id/versions] GET failed:", error);
        return NextResponse.json({ error: "Failed to load history" }, { status: 500 });
    }
}

/** Take a snapshot of the page as it stands right now. */
export async function POST(
    request: Request,
    { params }: { params: Promise<{ pageId: string }> }
) {
    try {
        const session = await getWorkspaceSession();
        if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { pageId } = await params;
        const validation = await validateRequestBody(request, SnapshotSchema);
        if (!validation.success) return validation.response;

        const page = await getPage(session.userId, pageId);
        if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });

        const version = await snapshotPage(session.userId, page, validation.data.label);
        if (!version) {
            return NextResponse.json({ error: "Failed to snapshot" }, { status: 500 });
        }

        return NextResponse.json({ version: serializeVersion(version) }, { status: 201 });
    } catch (error) {
        console.error("[workspace/pages/:id/versions] POST failed:", error);
        return NextResponse.json({ error: "Failed to snapshot page" }, { status: 500 });
    }
}
