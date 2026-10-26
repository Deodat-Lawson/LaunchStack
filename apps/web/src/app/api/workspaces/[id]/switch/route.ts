import { NextResponse } from "next/server";
import { eq, and, sql } from "drizzle-orm";

import { db } from "~/server/db";
import { users, userCompanyMemberships } from "~/server/db/schema";
import { setActiveWorkspaceCookie } from "~/lib/active-workspace";
import { requireAuthIdentity } from "~/lib/require-workspace-context";
import { requestTranslator } from "~/i18n/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const t = requestTranslator(request, "auth.server.errors");
    try {
        const identity = await requireAuthIdentity();
        if (!identity.success) return identity.response;
        const authUserId = identity.data.authUserId;

        const { id: rawId } = await params;
        let companyId: bigint;
        try {
            companyId = BigInt(rawId);
        } catch {
            return NextResponse.json(
                { error: requestTranslator(request, "errors.api")("invalidId") },
                { status: 400 }
            );
        }
        if (companyId <= 0n) {
            return NextResponse.json(
                { error: requestTranslator(request, "errors.api")("invalidId") },
                { status: 400 }
            );
        }

        const [user] = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.userId, authUserId));
        if (!user) {
            return NextResponse.json({ error: t("userNotFound") }, { status: 404 });
        }

        const [membership] = await db
            .select({ id: userCompanyMemberships.id, status: userCompanyMemberships.status })
            .from(userCompanyMemberships)
            .where(
                and(
                    eq(userCompanyMemberships.userId, BigInt(user.id)),
                    eq(userCompanyMemberships.companyId, companyId)
                )
            );

        if (!membership) {
            return NextResponse.json({ error: t("notAMember") }, { status: 403 });
        }
        if (membership.status === "suspended") {
            return NextResponse.json({ error: t("membershipSuspended") }, { status: 403 });
        }

        await db
            .update(userCompanyMemberships)
            .set({ lastOpenedAt: sql`CURRENT_TIMESTAMP` })
            .where(eq(userCompanyMemberships.id, membership.id));

        // A pending member may switch; the middleware keeps them on the
        // pending page until someone approves them.
        const response = NextResponse.json({
            success: true,
            redirectTo:
                membership.status === "pending"
                    ? "/employer/pending-approval"
                    : "/employer/documents",
        });
        setActiveWorkspaceCookie(response, companyId);
        return response;
    } catch (err) {
        console.error("[workspaces/switch] POST error:", err);
        return NextResponse.json(
            { error: requestTranslator(request, "errors.api")("internal") },
            { status: 500 }
        );
    }
}
