/**
 * The signed-in caller's own sessions: the devices list in Settings › Account.
 *
 * GET    — every unexpired session the caller holds, newest activity first,
 *          with the one making this request marked `current`.
 * DELETE — end one of them by id (`{ id }`), never the current one (that is
 *          what signing out is for).
 *
 * Why not Better Auth's own `list-sessions`: it refuses once the sign-in is
 * older than `freshAge` (a day), so anyone signed in since yesterday saw
 * "Session is not fresh" instead of their devices. It needs that gate because
 * it answers with each session's token, the secret behind the cookie. This
 * route never sends a token: rows carry their id, and ending one is looked up
 * by id on the server, so seeing your own devices needs only a session.
 * The gate stays where it guards something: unlinking a sign-in and setting
 * a password.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { auth, getServerSession } from "~/server/auth";
import { parseJsonBody } from "~/server/workspace/http";
import { requestTranslator } from "~/i18n/server";

export const dynamic = "force-dynamic";

/** One row of the devices list. No token: see the header. */
export interface DeviceSession {
    id: string;
    current: boolean;
    createdAt: string;
    updatedAt: string;
    expiresAt: string;
    ipAddress: string | null;
    userAgent: string | null;
}

const EndSessionSchema = z.object({ id: z.string().min(1) });

function iso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function activeSessions(userId: string) {
    const { internalAdapter } = await auth.$context;
    const now = Date.now();
    const rows = await internalAdapter.listSessions(userId, { onlyActiveSessions: true });
    return rows.filter(row => new Date(row.expiresAt).getTime() > now);
}

export async function GET(request: Request) {
    const session = await getServerSession();
    if (!session) {
        return NextResponse.json(
            { error: requestTranslator(request, "errors.api")("notSignedIn") },
            { status: 401 }
        );
    }
    try {
        const rows = await activeSessions(session.user.id);
        const sessions: DeviceSession[] = rows
            .map(row => ({
                id: row.id,
                current: row.id === session.session.id,
                createdAt: iso(row.createdAt),
                updatedAt: iso(row.updatedAt),
                expiresAt: iso(row.expiresAt),
                ipAddress: row.ipAddress ?? null,
                userAgent: row.userAgent ?? null,
            }))
            .sort((a, b) =>
                a.current !== b.current
                    ? a.current
                        ? -1
                        : 1
                    : b.updatedAt.localeCompare(a.updatedAt)
            );
        return NextResponse.json({ sessions });
    } catch (error) {
        console.error("[profile sessions GET]", error);
        return NextResponse.json(
            { error: requestTranslator(request, "settings.server.errors")("listSessionsFailed") },
            { status: 500 }
        );
    }
}

export async function DELETE(request: Request) {
    const t = requestTranslator(request, "settings.server.errors");
    // As in /api/profile/sign-in: the cookie is SameSite=Lax, and this also
    // refuses a sibling subdomain.
    const site = request.headers.get("sec-fetch-site");
    if (site && site !== "same-origin") {
        return NextResponse.json({ error: t("crossSiteRefused") }, { status: 403 });
    }
    const session = await getServerSession();
    if (!session) {
        return NextResponse.json(
            { error: requestTranslator(request, "errors.api")("notSignedIn") },
            { status: 401 }
        );
    }
    const body = await parseJsonBody(request, EndSessionSchema);
    if (!body.success) return body.response;
    if (body.data.id === session.session.id) {
        return NextResponse.json({ error: t("endCurrentSession") }, { status: 400 });
    }
    try {
        const target = (await activeSessions(session.user.id)).find(row => row.id === body.data.id);
        // Someone else's session reads exactly like one that has already ended.
        if (!target) {
            return NextResponse.json({ error: t("sessionNotFound") }, { status: 404 });
        }
        const { internalAdapter } = await auth.$context;
        await internalAdapter.deleteSession(target.token);
        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("[profile sessions DELETE]", error);
        return NextResponse.json({ error: t("endSessionFailed") }, { status: 500 });
    }
}
