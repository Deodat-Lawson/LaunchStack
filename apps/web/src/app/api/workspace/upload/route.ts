import { NextResponse } from "next/server";

import { uploadFile } from "~/lib/storage";
import { getWorkspaceSession } from "~/server/workspace/session";

/** 25 MB, matching what the editor's file blocks advertise. */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Image / file uploads for editor blocks, page icons, and covers. Delegates to
 * the app's configured storage backend so the editor never has to care whether
 * that is S3 or Postgres.
 */
export async function POST(request: Request) {
    try {
        const session = await getWorkspaceSession();
        if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File)) {
            return NextResponse.json({ error: "No file provided" }, { status: 400 });
        }
        if (file.size > MAX_BYTES) {
            return NextResponse.json(
                { error: "File is larger than 25 MB" },
                { status: 413 }
            );
        }

        const result = await uploadFile({
            filename: file.name || "upload",
            data: await file.arrayBuffer(),
            contentType: file.type || "application/octet-stream",
            userId: session.userId,
        });

        return NextResponse.json(
            {
                url: result.url,
                name: file.name,
                size: file.size,
                contentType: result.contentType ?? file.type,
            },
            { status: 201 }
        );
    } catch (error) {
        console.error("[workspace/upload] failed:", error);
        return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }
}
