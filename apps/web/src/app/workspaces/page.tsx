import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq, desc, count } from "drizzle-orm";

import { db } from "~/server/db";
import {
    users,
    company,
    userCompanyMemberships,
} from "@launchstack/core/db/schema";
import { getActiveCompanyId } from "~/lib/active-workspace";

import { WorkspaceSelectClient } from "./WorkspaceSelectClient";

export const dynamic = "force-dynamic";

export default async function WorkspacesPage({
    searchParams,
}: {
    searchParams: Promise<{ from?: string }>;
}) {
    const { userId } = await auth();
    if (!userId) redirect("/signin");

    const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.userId, userId));
    if (!user) redirect("/signup");

    const memberCountSubquery = db
        .select({
            companyId: userCompanyMemberships.companyId,
            memberCount: count(userCompanyMemberships.id).as("member_count"),
        })
        .from(userCompanyMemberships)
        .groupBy(userCompanyMemberships.companyId)
        .as("mc");

    const rows = await db
        .select({
            id: company.id,
            name: company.name,
            slug: company.slug,
            description: company.description,
            swatch: company.swatch,
            role: userCompanyMemberships.role,
            lastOpenedAt: userCompanyMemberships.lastOpenedAt,
            memberCount: memberCountSubquery.memberCount,
        })
        .from(userCompanyMemberships)
        .innerJoin(company, eq(company.id, userCompanyMemberships.companyId))
        .leftJoin(
            memberCountSubquery,
            eq(memberCountSubquery.companyId, userCompanyMemberships.companyId)
        )
        .where(eq(userCompanyMemberships.userId, BigInt(user.id)))
        .orderBy(desc(userCompanyMemberships.lastOpenedAt));

    const activeCompanyId = await getActiveCompanyId(userId);
    const clerkUser = await currentUser();
    const params = await searchParams;
    const fromSignup = params.from === "signup";

    const workspaces = rows.map((r) => ({
        id: r.id.toString(),
        name: r.name,
        slug: r.slug ?? "",
        description: r.description ?? null,
        swatch: r.swatch ?? 1,
        role: r.role,
        memberCount: Number(r.memberCount ?? 1),
        lastOpenedAt: r.lastOpenedAt.toISOString(),
        isActive: BigInt(r.id) === activeCompanyId,
    }));

    const accountName =
        clerkUser?.fullName ||
        [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(" ") ||
        clerkUser?.username ||
        "You";
    const accountEmail =
        clerkUser?.primaryEmailAddress?.emailAddress ?? "";

    return (
        <WorkspaceSelectClient
            workspaces={workspaces}
            account={{ name: accountName, email: accountEmail }}
            fromSignup={fromSignup}
        />
    );
}
