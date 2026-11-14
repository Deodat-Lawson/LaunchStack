/**
 * Photos for the account menu: each account signed in on this browser, by
 * auth user id, with its own photo URL (or null for initials). The accounts
 * come from the browser's signed session cookies, so a caller can't ask
 * about anyone else. The image route serves these URLs to the same browser.
 */

import { NextResponse } from "next/server";

import { deviceAccountUserIds } from "~/server/auth";
import { globalPhotoUrls } from "~/server/profile/store";
import { requestTranslator } from "~/i18n/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    try {
        const ids = await deviceAccountUserIds(request.headers);
        if (ids.length === 0) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const photos = await globalPhotoUrls(ids);
        return NextResponse.json(
            { photos: Object.fromEntries(ids.map(id => [id, photos.get(id) ?? null])) },
            { headers: { "Cache-Control": "private, no-store" } }
        );
    } catch (error) {
        console.error("[profile/device-photos GET] failed:", error);
        return NextResponse.json(
            { error: requestTranslator(request, "errors.api")("internal") },
            { status: 500 }
        );
    }
}
