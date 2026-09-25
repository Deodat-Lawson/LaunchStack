/**
 * Serves a profile photo.
 *
 * Session only — a photo is not workspace-scoped the way `/api/files` is,
 * because one person's photo appears in every workspace they belong to.
 * Who may see which photo is `canViewProfileImage`; anyone else gets the
 * same 404 as a missing id, so ids can't be probed.
 *
 * Ids are minted per upload, so a URL's bytes never change: cache forever.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { requireAuthIdentity } from "~/lib/require-workspace-context";
import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { canViewProfileImage, readProfileImage } from "~/server/profile/store";

export const dynamic = "force-dynamic";

const ID = /^[A-Za-z0-9_-]{16,32}$/;

function notFound() {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    if (!ID.test(id)) return notFound();

    const identity = await requireAuthIdentity();
    if (!identity.success) return identity.response;

    try {
        const [viewer] = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.userId, identity.data.authUserId));
        if (!viewer) return notFound();

        const image = await readProfileImage(id);
        if (!image) return notFound();
        if (!(await canViewProfileImage(BigInt(viewer.id), image))) return notFound();

        return new NextResponse(new Uint8Array(image.data), {
            status: 200,
            headers: {
                "Content-Type": image.mimeType,
                "Content-Length": String(image.data.length),
                "Cache-Control": "private, max-age=31536000, immutable",
                "X-Content-Type-Options": "nosniff",
            },
        });
    } catch (error) {
        console.error("[profile-images GET] failed:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
