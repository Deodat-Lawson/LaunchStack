/**
 * The caller's ways of signing in, beyond what Better Auth's own
 * list-accounts answers.
 *
 * GET  — the social providers this deployment offers, so Settings › Account
 *        can offer to connect the ones not linked yet.
 * POST — set a password on an account that has none: one made with Google or
 *        GitHub, or one whose unconfirmed password a provider sign-in removed
 *        (~/server/auth/account-linking). Better Auth keeps `setPassword`
 *        server-only because it asks for no current password, so it is
 *        reached only here: for the signed-in caller's own account, from a
 *        page on this origin, on a recent sign-in (Better Auth's freshAge,
 *        a day by default), so a stolen session cookie can't be turned into
 *        a password that outlives it.
 */

import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { isAPIError } from "better-auth/api";
import { z } from "zod";

import { auth, getServerSession } from "~/server/auth";
import { enabledSocialProviders } from "~/server/auth/providers";
import { parseJsonBody } from "~/server/workspace/http";

export const dynamic = "force-dynamic";

/** Better Auth's own bounds for a password (minPasswordLength/maxPasswordLength). */
const SetPasswordSchema = z.object({ newPassword: z.string().min(8).max(128) });

export async function GET() {
    const session = await getServerSession();
    if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    return NextResponse.json({ providers: enabledSocialProviders() });
}

export async function POST(request: Request) {
    // The session cookie is SameSite=Lax, so another site cannot post here
    // with it; this refuses the same-site case (a sibling subdomain) too.
    // Browsers always send the header on fetch; a non-browser caller has no
    // ambient cookie to abuse.
    const site = request.headers.get("sec-fetch-site");
    if (site && site !== "same-origin") {
        return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
    }
    const session = await getServerSession();
    if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const { freshAge } = (await auth.$context).sessionConfig;
    const age = Date.now() - new Date(session.session.createdAt).getTime();
    if (freshAge > 0 && age > freshAge * 1000) {
        return NextResponse.json(
            { error: "For your security, sign out and sign in again, then set your password." },
            { status: 403 }
        );
    }
    const body = await parseJsonBody(request, SetPasswordSchema);
    if (!body.success) return body.response;
    try {
        await auth.api.setPassword({
            body: { newPassword: body.data.newPassword },
            headers: await headers(),
        });
        return NextResponse.json({ ok: true });
    } catch (error) {
        if (isAPIError(error)) {
            return NextResponse.json(
                { error: error.body?.message ?? error.message },
                { status: error.statusCode }
            );
        }
        console.error("[profile sign-in POST]", error);
        return NextResponse.json({ error: "Could not set a password" }, { status: 500 });
    }
}
