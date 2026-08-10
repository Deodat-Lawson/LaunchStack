import { NextResponse } from "next/server";
// The second postgres pool (~/server/db/core) was removed — hot routes use
// the engine's shared Drizzle client like everything else.
import { db } from "~/server/db";
import { company } from "@launchstack/core/db/schema";
import { users, userCompanyMemberships } from "~/server/db/schema";
import { and, eq } from "drizzle-orm";
import { requireClerkIdentity } from "~/lib/require-workspace-context";
import { resolveActiveCompanyForUser } from "~/lib/active-workspace";

/**
 * Profile lookup for the signed-in Clerk user — including unverified /
 * pending-approval accounts. Uses requireClerkIdentity (not workspace
 * context) so pending pages can load name/company/submission date.
 *
 * The company reported here is the *active* workspace, matching what the
 * product APIs scope to. Pending users with no membership keep the legacy
 * default company and global role so the approval pages still render;
 * verified users require a current membership.
 */
export async function POST() {
    try {
        const identity = await requireClerkIdentity();
        if (!identity.success) return identity.response;

        const [userInfo] = await db
            .select()
            .from(users)
            .where(eq(users.userId, identity.data.clerkUserId));

        if (!userInfo) {
            return NextResponse.json({ error: "Invalid user." }, { status: 401 });
        }

        const companyId = await resolveActiveCompanyForUser(
            userInfo.id,
            userInfo.companyId,
            userInfo.status,
        );

        if (companyId === null) {
            return NextResponse.json(
                { error: "No active workspace" },
                { status: 403 },
            );
        }

        const [membership] = await db
            .select({ role: userCompanyMemberships.role })
            .from(userCompanyMemberships)
            .where(
                and(
                    eq(userCompanyMemberships.userId, BigInt(userInfo.id)),
                    eq(userCompanyMemberships.companyId, companyId),
                ),
            );

        if (!membership && userInfo.status === "verified") {
            return NextResponse.json(
                { error: "No active workspace membership" },
                { status: 403 },
            );
        }

        const [companyRecord] = await db
            .select()
            .from(company)
            .where(and(eq(company.id, Number(companyId))));

        if (!companyRecord) {
            return NextResponse.json(
                { error: "Company not found" },
                { status: 404 }
            );
        }

        const submissionDate = new Date(userInfo.createdAt).toLocaleString("en-US", {
            dateStyle: "medium",
            timeStyle: "short",
        });

        const serializedUserInfo = {
            ...userInfo,
            companyId: Number(companyId),
            role: membership?.role ?? (
                userInfo.status === "pending" ? userInfo.role : ""
            ),
        };

        return NextResponse.json(
            {
                ...serializedUserInfo,
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
