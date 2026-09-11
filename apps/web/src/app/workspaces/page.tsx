import { redirect } from "next/navigation";
import { and, count, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { getServerSession } from "~/server/auth";

import { db } from "~/server/db";
import { company } from "@launchstack/store/schema";
import { users, userCompanyMemberships, workspaceInvitations } from "~/server/db/schema";
import { getActiveCompanyId } from "~/lib/active-workspace";

import { WorkspaceSelectClient, type PendingInvite } from "./WorkspaceSelectClient";

export const dynamic = "force-dynamic";

export default async function WorkspacesPage({
    searchParams,
}: {
    searchParams: Promise<{ from?: string }>;
}) {
    const session = await getServerSession();
    const userId = session?.user.id;
    if (!userId) redirect("/signin");

    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.userId, userId));
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
            status: userCompanyMemberships.status,
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

    // Invitations addressed to this account's email that are still open:
    // not accepted, not withdrawn, not past their expiry.
    const accountEmail = session.user.email;
    const inviter = alias(users, "inviter");
    const inviteRows = accountEmail
        ? await db
              .select({
                  id: workspaceInvitations.id,
                  companyName: company.name,
                  slug: company.slug,
                  swatch: company.swatch,
                  role: workspaceInvitations.role,
                  createdAt: workspaceInvitations.createdAt,
                  invitedByName: inviter.name,
              })
              .from(workspaceInvitations)
              .innerJoin(company, eq(company.id, workspaceInvitations.companyId))
              .leftJoin(inviter, eq(inviter.userId, workspaceInvitations.invitedBy))
              .where(
                  and(
                      sql`lower(${workspaceInvitations.email}) = ${accountEmail.toLowerCase()}`,
                      isNull(workspaceInvitations.acceptedAt),
                      isNull(workspaceInvitations.revokedAt),
                      gt(workspaceInvitations.expiresAt, new Date())
                  )
              )
              .orderBy(desc(workspaceInvitations.createdAt))
        : [];

    const activeCompanyId = await getActiveCompanyId(userId);
    const params = await searchParams;
    const fromSignup = params.from === "signup";

    const workspaces = rows.map(r => ({
        id: r.id.toString(),
        name: r.name,
        slug: r.slug ?? "",
        description: r.description ?? null,
        swatch: r.swatch ?? 1,
        role: r.role,
        status: r.status,
        memberCount: Number(r.memberCount ?? 1),
        lastOpenedAt: r.lastOpenedAt.toISOString(),
        // A null active id is a safe recovery state: the user can choose one
        // of their live memberships instead of inheriting a stale default.
        isActive: activeCompanyId !== null && BigInt(r.id) === activeCompanyId,
    }));

    const alreadyIn = new Set(rows.map(r => r.name));
    const pendingInvites: PendingInvite[] = inviteRows
        // An invitation to a workspace the person is already in is stale.
        .filter(inv => !alreadyIn.has(inv.companyName))
        .map(inv => ({
            id: inv.id.toString(),
            companyName: inv.companyName,
            slug: inv.slug ?? "",
            swatch: inv.swatch ?? 1,
            invitedBy: inv.invitedByName ?? "a teammate",
            invitedAt: inv.createdAt.toISOString(),
            role: inv.role,
        }));

    // `.trim()` so a whitespace-only name still falls through to "You".
    const accountName = session.user.name.trim() || "You";

    return (
        <WorkspaceSelectClient
            workspaces={workspaces}
            account={{ name: accountName, email: accountEmail }}
            fromSignup={fromSignup}
            pendingInvites={pendingInvites}
        />
    );
}
