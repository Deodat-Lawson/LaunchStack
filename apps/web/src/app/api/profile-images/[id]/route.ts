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
import { requestTranslator } from "~/i18n/server";

export const dynamic = "force-dynamic";

const ID = /^[A-Za-z0-9_-]{16,32}$/;

function notFound(request: Request) {
    return NextResponse.json(
        { error: requestTranslator(request, "errors.api")("notFound") },
        { status: 404 }
    );
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    if (!ID.test(id)) return notFound(request);

    const identity = await requireAuthIdentity();
    if (!identity.success) return identity.response;

    try {
        const [viewer] = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.userId, identity.data.authUserId));
        if (!viewer) return notFound(request);

        const image = await readProfileImage(id);
        if (!image) return notFound(request);
        if (!(await canViewProfileImage(BigInt(viewer.id), image))) return notFound(request);

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
        return NextResponse.json(
            { error: requestTranslator(request, "errors.api")("internal") },
            { status: 500 }
        );
    }
}
