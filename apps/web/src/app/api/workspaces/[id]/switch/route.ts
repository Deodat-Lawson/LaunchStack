import { NextResponse } from "next/server";
import { eq, and, sql } from "drizzle-orm";

import { db } from "~/server/db";
import { users, userCompanyMemberships } from "~/server/db/schema";
import { setActiveWorkspaceCookie } from "~/lib/active-workspace";
import { requireClerkIdentity } from "~/lib/require-workspace-context";

export async function POST(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const identity = await requireClerkIdentity();
        if (!identity.success) return identity.response;
        const clerkUserId = identity.data.clerkUserId;

        const { id: rawId } = await params;
        let companyId: bigint;
        try {
            companyId = BigInt(rawId);
        } catch {
            return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        }
        if (companyId <= 0n) {
            return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        }

        const [user] = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.userId, clerkUserId));
        if (!user) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        const [membership] = await db
            .select({ id: userCompanyMemberships.id })
            .from(userCompanyMemberships)
            .where(
                and(
                    eq(userCompanyMemberships.userId, BigInt(user.id)),
                    eq(userCompanyMemberships.companyId, companyId)
                )
            );

        if (!membership) {
            return NextResponse.json(
                { error: "You are not a member of this workspace" },
                { status: 403 }
            );
        }

        await db
            .update(userCompanyMemberships)
            .set({ lastOpenedAt: sql`CURRENT_TIMESTAMP` })
            .where(eq(userCompanyMemberships.id, membership.id));

        const response = NextResponse.json({
            success: true,
            redirectTo: "/employer/documents",
        });
        setActiveWorkspaceCookie(response, companyId);
        return response;
    } catch (err) {
        console.error("[workspaces/switch] POST error:", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
