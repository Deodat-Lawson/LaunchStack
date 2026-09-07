import { NextResponse } from "next/server";
// The second postgres pool (~/server/db/core) was removed — hot routes use
// the engine's shared Drizzle client like everything else.
import { db } from "~/server/db";
import { company } from "@launchstack/store/schema";
import { users, userCompanyMemberships } from "~/server/db/schema";
import { and, eq } from "drizzle-orm";
import { requireAuthIdentity } from "~/lib/require-workspace-context";
import { resolveActiveCompanyForUser } from "~/lib/active-workspace";
import { resolveRole } from "~/lib/authz/resolve";
import { isMembershipStatus, roleLabel } from "~/lib/authz/permissions";

/**
 * Profile lookup for the signed-in user — including pending-approval
 * memberships. Uses requireAuthIdentity (not workspace context) so pending
 * pages can load name/company/submission date.
 *
 * The company reported here is the *active* workspace, matching what the
 * product APIs scope to. Alongside the role it returns the resolved
 * permission set and the membership status, which is what the client's
 * `usePermissions()` hook consumes.
 */
export async function POST() {
    try {
        const identity = await requireAuthIdentity();
        if (!identity.success) return identity.response;

        const [userInfo] = await db
            .select({
                id: users.id,
                name: users.name,
                email: users.email,
                userId: users.userId,
                companyId: users.companyId,
                lastActiveAt: users.lastActiveAt,
                createdAt: users.createdAt,
            })
            .from(users)
            .where(eq(users.userId, identity.data.authUserId));

        if (!userInfo) {
            return NextResponse.json({ error: "Invalid user." }, { status: 401 });
        }

        const companyId = await resolveActiveCompanyForUser(userInfo.id, userInfo.companyId);

        if (companyId === null) {
            return NextResponse.json({ error: "No active workspace" }, { status: 403 });
        }

        const [membership] = await db
            .select({ role: userCompanyMemberships.role, status: userCompanyMemberships.status })
            .from(userCompanyMemberships)
            .where(
                and(
                    eq(userCompanyMemberships.userId, BigInt(userInfo.id)),
                    eq(userCompanyMemberships.companyId, companyId)
                )
            );

        if (!membership) {
            return NextResponse.json({ error: "No active workspace membership" }, { status: 403 });
        }

        const [companyRecord] = await db
            .select()
            .from(company)
            .where(and(eq(company.id, Number(companyId))));

        if (!companyRecord) {
            return NextResponse.json({ error: "Company not found" }, { status: 404 });
        }

        const resolved = await resolveRole(companyId, membership.role);
        const membershipStatus = isMembershipStatus(membership.status)
            ? membership.status
            : "active";

        const submissionDate = new Date(userInfo.createdAt).toLocaleString("en-US", {
            dateStyle: "medium",
            timeStyle: "short",
        });

        return NextResponse.json(
            {
                ...userInfo,
                companyId: Number(companyId),
                role: resolved.slug,
                roleName: roleLabel(resolved.slug, resolved.name),
                membershipStatus,
                // Suspended and pending members hold no permissions until reinstated.
                permissions: membershipStatus === "active" ? [...resolved.permissions] : [],
                company: companyRecord.name,
                submissionDate: submissionDate,
            },
            { status: 200 }
        );
    } catch (error: unknown) {
        console.error("Error fetching user and company info:", error);
        return NextResponse.json(
            { error: "Unable to fetch user and company info" },
            { status: 500 }
        );
    }
}
