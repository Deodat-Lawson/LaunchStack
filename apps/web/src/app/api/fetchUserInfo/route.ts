import { NextResponse } from "next/server";
import { dbCore } from "../../../server/db/core";
import { company, users, userCompanyMemberships } from "@launchstack/core/db/schema";
import { and, eq } from "drizzle-orm";
import { requireClerkIdentity } from "~/lib/require-workspace-context";
import { resolveActiveCompanyForUser } from "~/lib/active-workspace";

/**
 * Profile lookup for the signed-in Clerk user — including unverified /
 * pending-approval accounts. Uses requireClerkIdentity (not workspace
 * context) so pending pages can load name/company/submission date.
 *
 * The company reported here is the *active* workspace, matching what the
 * product APIs scope to. Callers with no valid selection fall back to their
 * default workspace, and pending users with no membership keep the legacy
 * global role so the approval pages still render.
 */
export async function POST() {
    try {
        const identity = await requireClerkIdentity();
        if (!identity.success) return identity.response;

        const [userInfo] = await dbCore
            .select()
            .from(users)
            .where(eq(users.userId, identity.data.clerkUserId));

        if (!userInfo) {
            return NextResponse.json({ error: "Invalid user." }, { status: 401 });
        }

        const companyId = await resolveActiveCompanyForUser(
            userInfo.id,
            userInfo.companyId,
        );

        const [membership] = await dbCore
            .select({ role: userCompanyMemberships.role })
            .from(userCompanyMemberships)
            .where(
                and(
                    eq(userCompanyMemberships.userId, BigInt(userInfo.id)),
                    eq(userCompanyMemberships.companyId, companyId),
                ),
            );

        const [companyRecord] = await dbCore
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
            role: membership?.role ?? userInfo.role,
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
