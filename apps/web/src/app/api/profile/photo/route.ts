/**
 * The caller's profile photo.
 *
 * PUT    ?scope=global|workspace — multipart `file`. Re-encoded server-side
 *        (square WebP, metadata stripped) before it is stored.
 * DELETE ?scope=global|workspace — back to initials, or to the profile photo.
 *
 * `workspace` means the active workspace and needs an active membership.
 */

import { NextResponse } from "next/server";

import { isProfileScope, type ProfileScope } from "~/lib/profile/fields";
import { resolveProfileCaller } from "~/server/profile/caller";
import { normalizeProfilePhoto, ProfilePhotoError } from "~/server/profile/photo";
import { removeProfilePhoto, replaceProfilePhoto } from "~/server/profile/store";
import { workspaceErrorResponse } from "~/server/workspace/http";

export const dynamic = "force-dynamic";

function scopeOf(request: Request): ProfileScope | null {
    const raw = new URL(request.url).searchParams.get("scope") ?? "global";
    return isProfileScope(raw) ? raw : null;
}

function badScope() {
    return NextResponse.json({ error: "scope must be global or workspace" }, { status: 400 });
}

export async function PUT(request: Request) {
    const scope = scopeOf(request);
    if (!scope) return badScope();
    const caller = await resolveProfileCaller();
    if (!caller.success) return caller.response;

    let file: FormDataEntryValue | null;
    try {
        file = (await request.formData()).get("file");
    } catch {
        return NextResponse.json(
            { error: "Send the photo as multipart form data." },
            { status: 400 }
        );
    }
    if (!(file instanceof Blob)) {
        return NextResponse.json({ error: "Attach the photo as `file`." }, { status: 400 });
    }

    try {
        const photo = await normalizeProfilePhoto(Buffer.from(await file.arrayBuffer()));
        return NextResponse.json(await replaceProfilePhoto(caller.data, scope, photo));
    } catch (error) {
        if (error instanceof ProfilePhotoError) {
            return NextResponse.json({ error: error.message }, { status: 422 });
        }
        return workspaceErrorResponse(error, "[profile/photo PUT]");
    }
}

export async function DELETE(request: Request) {
    const scope = scopeOf(request);
    if (!scope) return badScope();
    const caller = await resolveProfileCaller();
    if (!caller.success) return caller.response;
    try {
        return NextResponse.json(await removeProfilePhoto(caller.data, scope));
    } catch (error) {
        return workspaceErrorResponse(error, "[profile/photo DELETE]");
    }
}
