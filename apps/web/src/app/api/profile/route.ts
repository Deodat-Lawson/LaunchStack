/**
 * The caller's profile.
 *
 * GET   — profile, override in the active workspace, and what that workspace sees.
 *         The first GET after a Google/GitHub sign-up imports that photo.
 * PATCH — profile fields (name, display name, title, pronouns, time zone, bio).
 *
 * Better Auth owns the sign-in copy of the name (`auth_user.name`) and the
 * browser updates it through `authClient.updateUser`; this route keeps the
 * product `users` row — what member lists and audit trails read — in step.
 */

import { NextResponse } from "next/server";

import { ProfilePatchSchema } from "~/lib/profile/fields";
import { resolveProfileCaller } from "~/server/profile/caller";
import { importProviderPhotoOnce } from "~/server/profile/provider-photo";
import { loadMyProfile, updateProfile } from "~/server/profile/store";
import { parseJsonBody, workspaceErrorResponse } from "~/server/workspace/http";

export const dynamic = "force-dynamic";

export async function GET() {
    const caller = await resolveProfileCaller();
    if (!caller.success) return caller.response;
    try {
        // First load after a Google/GitHub sign-up: bring that photo across.
        // A no-op (one indexed update matching nothing) for everyone else.
        await importProviderPhotoOnce(caller.data.userPk);
        return NextResponse.json(await loadMyProfile(caller.data));
    } catch (error) {
        return workspaceErrorResponse(error, "[profile GET]");
    }
}

export async function PATCH(request: Request) {
    const caller = await resolveProfileCaller();
    if (!caller.success) return caller.response;
    const body = await parseJsonBody(request, ProfilePatchSchema);
    if (!body.success) return body.response;
    try {
        return NextResponse.json(await updateProfile(caller.data, body.data));
    } catch (error) {
        return workspaceErrorResponse(error, "[profile PATCH]");
    }
}
