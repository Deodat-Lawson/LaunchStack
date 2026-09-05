/**
 * Email invitations. The token travels in the accept link only; the row
 * keeps its SHA-256. Accepting creates an active membership — an invitation
 * is pre-approval by someone who may hand out that role.
 */

import { createHash, randomBytes } from "node:crypto";

import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";

import { company } from "@launchstack/store/schema";
import { db } from "~/server/db";
import {
    userCompanyMemberships,
    users,
    workspaceGroupMembers,
    workspaceGroups,
    workspaceInvitations,
} from "~/server/db/schema";
import { sendAuthEmail } from "~/server/auth/email";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { recordAuditEvent } from "~/lib/authz/audit";
import { normalizeRoleSlug, roleLabel } from "~/lib/authz/permissions";
import { resolveRole } from "~/lib/authz/resolve";

import { badRequest, conflict, forbidden, gone, notFound } from "./errors";
import { customRoleNames, displayRoleName, requireAssignableRole } from "./roles";
import type { SessionUser } from "./session";
import { ensureUserRow } from "./user-row";

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export interface InvitationView {
    id: number;
    email: string;
    role: string;
    roleName: string;
    groupIds: number[];
    invitedBy: { name: string; email: string } | null;
    createdAt: string;
    expiresAt: string;
    status: InvitationStatus;
}

export interface InvitationPreview {
    workspaceName: string;
    workspaceSlug: string | null;
    role: string;
    roleName: string;
    email: string;
    expiresAt: string;
    status: InvitationStatus;
}

export interface AcceptInvitationResult {
    success: true;
    companyId: number;
    redirectTo: string;
    alreadyMember: boolean;
}

interface InvitationRow {
    id: number;
    companyId: bigint;
    email: string;
    role: string;
    groupIds: bigint[];
    invitedBy: string;
    expiresAt: Date;
    acceptedAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
}

// ---------------------------------------------------------------------------
// Tokens and status
// ---------------------------------------------------------------------------

export function hashInvitationToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
    return randomBytes(32).toString("base64url");
}

export function invitationStatus(
    row: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
    now: Date = new Date()
): InvitationStatus {
    if (row.acceptedAt) return "accepted";
    if (row.revokedAt) return "revoked";
    if (row.expiresAt.getTime() <= now.getTime()) return "expired";
    return "pending";
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

async function toViews(companyId: bigint, rows: InvitationRow[]): Promise<InvitationView[]> {
    const inviterIds = [...new Set(rows.map(r => r.invitedBy))];
    const [names, inviters] = await Promise.all([
        customRoleNames(companyId),
        inviterIds.length === 0
            ? Promise.resolve([])
            : db
                  .select({ userId: users.userId, name: users.name, email: users.email })
                  .from(users)
                  .where(inArray(users.userId, inviterIds)),
    ]);
    const inviterByAuthId = new Map(
        inviters.map(i => [i.userId, { name: i.name, email: i.email }])
    );
    return rows.map(row => {
        const role = normalizeRoleSlug(row.role);
        return {
            id: Number(row.id),
            email: row.email,
            role,
            roleName: displayRoleName(role, names),
            groupIds: (row.groupIds ?? []).map(Number),
            invitedBy: inviterByAuthId.get(row.invitedBy) ?? null,
            createdAt: row.createdAt.toISOString(),
            expiresAt: row.expiresAt.toISOString(),
            status: invitationStatus(row),
        };
    });
}

export async function listInvitations(ctx: WorkspaceContext): Promise<InvitationView[]> {
    const rows = await db
        .select()
        .from(workspaceInvitations)
        .where(eq(workspaceInvitations.companyId, ctx.companyId))
        .orderBy(desc(workspaceInvitations.id));
    return toViews(ctx.companyId, rows);
}

async function loadInvitation(companyId: bigint, id: number): Promise<InvitationRow> {
    const [row] = await db
        .select()
        .from(workspaceInvitations)
        .where(and(eq(workspaceInvitations.companyId, companyId), eq(workspaceInvitations.id, id)))
        .limit(1);
    if (!row) throw notFound("Invitation not found.");
    return row;
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

export function invitationEmailText(input: {
    workspaceName: string;
    roleName: string;
    inviterName: string;
    acceptUrl: string;
    expiresAt: Date;
}): string {
    const expires = input.expiresAt.toUTCString();
    return [
        `${input.inviterName} has invited you to join ${input.workspaceName} on LaunchStack as ${input.roleName}.`,
        "",
        "Accept the invitation here:",
        input.acceptUrl,
        "",
        `This link expires on ${expires}. If you were not expecting it, you can ignore this email.`,
    ].join("\n");
}

async function deliver(
    ctx: WorkspaceContext,
    row: Pick<InvitationRow, "email" | "role" | "expiresAt">,
    token: string,
    origin: string
): Promise<string> {
    const acceptUrl = `${origin}/invite/${token}`;
    const [workspaceRows, inviterRows, names] = await Promise.all([
        db
            .select({ name: company.name })
            .from(company)
            .where(eq(company.id, Number(ctx.companyId)))
            .limit(1),
        db
            .select({ name: users.name })
            .from(users)
            .where(eq(users.userId, ctx.authUserId))
            .limit(1),
        customRoleNames(ctx.companyId),
    ]);
    const workspaceName = workspaceRows[0]?.name ?? "a workspace";
    const inviterName = inviterRows[0]?.name ?? "A workspace admin";
    await sendAuthEmail({
        to: row.email,
        subject: `You're invited to ${workspaceName} on LaunchStack`,
        text: invitationEmailText({
            workspaceName,
            roleName: displayRoleName(row.role, names),
            inviterName,
            acceptUrl,
            expiresAt: row.expiresAt,
        }),
    });
    return acceptUrl;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function knownGroupIds(companyId: bigint, groupIds: readonly number[]): Promise<number[]> {
    const unique = [...new Set(groupIds)];
    if (unique.length === 0) return [];
    const rows = await db
        .select({ id: workspaceGroups.id })
        .from(workspaceGroups)
        .where(and(eq(workspaceGroups.companyId, companyId), inArray(workspaceGroups.id, unique)));
    const known = new Set(rows.map(r => Number(r.id)));
    const missing = unique.filter(id => !known.has(id));
    if (missing.length > 0) throw badRequest(`Unknown group id ${missing[0]}.`);
    return unique;
}

export async function createInvitation(
    ctx: WorkspaceContext,
    input: { email: string; role: string; groupIds?: number[] },
    origin: string
): Promise<{ invitation: InvitationView; acceptUrl: string }> {
    const email = input.email.trim().toLowerCase();
    const role = await requireAssignableRole(ctx, input.role);

    const existing = await db
        .select({ status: userCompanyMemberships.status })
        .from(userCompanyMemberships)
        .innerJoin(users, eq(users.id, userCompanyMemberships.userId))
        .where(
            and(
                eq(userCompanyMemberships.companyId, ctx.companyId),
                sql`lower(${users.email}) = ${email}`,
                inArray(userCompanyMemberships.status, ["active", "pending"])
            )
        )
        .limit(1);
    if (existing[0]) {
        throw conflict(
            existing[0].status === "pending"
                ? "That person already has a pending request to join this workspace."
                : "That person is already a member of this workspace."
        );
    }

    const pending = await db
        .select({ id: workspaceInvitations.id })
        .from(workspaceInvitations)
        .where(
            and(
                eq(workspaceInvitations.companyId, ctx.companyId),
                eq(workspaceInvitations.email, email),
                isNull(workspaceInvitations.acceptedAt),
                isNull(workspaceInvitations.revokedAt),
                gt(workspaceInvitations.expiresAt, new Date())
            )
        )
        .limit(1);
    if (pending.length > 0) throw conflict("An invitation is already pending for that email.");

    const groupIds = await knownGroupIds(ctx.companyId, input.groupIds ?? []);
    const token = newToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

    const row = await db.transaction(async tx => {
        const [inserted] = await tx
            .insert(workspaceInvitations)
            .values({
                companyId: ctx.companyId,
                email,
                role: role.slug,
                groupIds: groupIds.map(id => BigInt(id)),
                tokenHash: hashInvitationToken(token),
                invitedBy: ctx.authUserId,
                expiresAt,
            })
            .returning();
        if (!inserted) throw new Error("Invitation insert returned no row");
        await recordAuditEvent(tx, {
            companyId: ctx.companyId,
            actorUserId: ctx.authUserId,
            action: "member.invited",
            targetType: "invitation",
            targetId: inserted.id,
            detail: { email, role: role.slug, groupIds },
        });
        return inserted;
    });

    const acceptUrl = await deliver(ctx, row, token, origin);
    const [invitation] = await toViews(ctx.companyId, [row]);
    if (!invitation) throw new Error("Invitation view missing");
    return { invitation, acceptUrl };
}

export async function resendInvitation(
    ctx: WorkspaceContext,
    id: number,
    origin: string
): Promise<{ invitation: InvitationView; acceptUrl: string }> {
    const row = await loadInvitation(ctx.companyId, id);
    const status = invitationStatus(row);
    if (status === "accepted") throw conflict("This invitation was already accepted.");
    if (status === "revoked")
        throw conflict("This invitation was revoked. Send a new one instead.");

    const token = newToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    await db.transaction(async tx => {
        await tx
            .update(workspaceInvitations)
            .set({ tokenHash: hashInvitationToken(token), expiresAt })
            .where(eq(workspaceInvitations.id, id));
        await recordAuditEvent(tx, {
            companyId: ctx.companyId,
            actorUserId: ctx.authUserId,
            action: "invitation.resent",
            targetType: "invitation",
            targetId: id,
            detail: { email: row.email },
        });
    });

    const refreshed = { ...row, expiresAt };
    const acceptUrl = await deliver(ctx, refreshed, token, origin);
    const [invitation] = await toViews(ctx.companyId, [refreshed]);
    if (!invitation) throw new Error("Invitation view missing");
    return { invitation, acceptUrl };
}

export async function revokeInvitation(
    ctx: WorkspaceContext,
    id: number
): Promise<{ success: true }> {
    const row = await loadInvitation(ctx.companyId, id);
    if (row.acceptedAt) throw conflict("This invitation was already accepted.");
    if (row.revokedAt) return { success: true };

    await db.transaction(async tx => {
        await tx
            .update(workspaceInvitations)
            .set({ revokedAt: new Date() })
            .where(eq(workspaceInvitations.id, id));
        await recordAuditEvent(tx, {
            companyId: ctx.companyId,
            actorUserId: ctx.authUserId,
            action: "invitation.revoked",
            targetType: "invitation",
            targetId: id,
            detail: { email: row.email },
        });
    });
    return { success: true };
}

// ---------------------------------------------------------------------------
// The invitee's side
// ---------------------------------------------------------------------------

export async function previewInvitation(token: string): Promise<InvitationPreview> {
    const [row] = await db
        .select({
            companyId: workspaceInvitations.companyId,
            email: workspaceInvitations.email,
            role: workspaceInvitations.role,
            expiresAt: workspaceInvitations.expiresAt,
            acceptedAt: workspaceInvitations.acceptedAt,
            revokedAt: workspaceInvitations.revokedAt,
            workspaceName: company.name,
            workspaceSlug: company.slug,
        })
        .from(workspaceInvitations)
        .innerJoin(company, eq(company.id, workspaceInvitations.companyId))
        .where(eq(workspaceInvitations.tokenHash, hashInvitationToken(token)))
        .limit(1);
    if (!row) throw notFound("This invitation does not exist.");

    const resolved = await resolveRole(row.companyId, row.role);
    return {
        workspaceName: row.workspaceName,
        workspaceSlug: row.workspaceSlug ?? null,
        role: resolved.slug,
        roleName: roleLabel(resolved.slug, resolved.name),
        email: row.email,
        expiresAt: row.expiresAt.toISOString(),
        status: invitationStatus(row),
    };
}

export async function acceptInvitation(
    user: SessionUser,
    input: { token?: string; invitationId?: number; name?: string }
): Promise<AcceptInvitationResult> {
    let rows: InvitationRow[];
    if (input.token) {
        rows = await db
            .select()
            .from(workspaceInvitations)
            .where(eq(workspaceInvitations.tokenHash, hashInvitationToken(input.token)))
            .limit(1);
    } else if (input.invitationId !== undefined) {
        rows = await db
            .select()
            .from(workspaceInvitations)
            .where(eq(workspaceInvitations.id, input.invitationId))
            .limit(1);
    } else {
        throw badRequest("Provide an invitation token.");
    }
    const row = rows[0];
    if (!row) throw notFound("This invitation does not exist.");

    const status = invitationStatus(row);
    if (status === "accepted") throw gone("This invitation has already been used.");
    if (status === "revoked") throw gone("This invitation was revoked.");
    if (status === "expired") throw gone("This invitation has expired. Ask for a new one.");
    if (row.email.trim().toLowerCase() !== user.email) {
        throw forbidden("This invitation was sent to a different email address.");
    }

    const role = normalizeRoleSlug(row.role) === "owner" ? "admin" : normalizeRoleSlug(row.role);

    return db.transaction(async tx => {
        const userPk = await ensureUserRow(tx, user, {
            name: input.name,
            companyId: row.companyId,
        });

        const [membership] = await tx
            .select({ status: userCompanyMemberships.status })
            .from(userCompanyMemberships)
            .where(
                and(
                    eq(userCompanyMemberships.userId, userPk),
                    eq(userCompanyMemberships.companyId, row.companyId)
                )
            )
            .limit(1);

        let alreadyMember = false;
        if (!membership) {
            await tx.insert(userCompanyMemberships).values({
                userId: userPk,
                companyId: row.companyId,
                role,
                status: "active",
            });
        } else if (membership.status === "suspended") {
            throw conflict("Your membership in this workspace is suspended.");
        } else if (membership.status === "pending") {
            await tx
                .update(userCompanyMemberships)
                .set({ role, status: "active" })
                .where(
                    and(
                        eq(userCompanyMemberships.userId, userPk),
                        eq(userCompanyMemberships.companyId, row.companyId)
                    )
                );
        } else {
            alreadyMember = true;
        }

        const groupIds = (row.groupIds ?? []).map(Number);
        if (groupIds.length > 0) {
            const groups = await tx
                .select({ id: workspaceGroups.id })
                .from(workspaceGroups)
                .where(
                    and(
                        eq(workspaceGroups.companyId, row.companyId),
                        inArray(workspaceGroups.id, groupIds)
                    )
                );
            if (groups.length > 0) {
                await tx
                    .insert(workspaceGroupMembers)
                    .values(
                        groups.map(g => ({
                            groupId: BigInt(g.id),
                            userId: userPk,
                            addedBy: row.invitedBy,
                        }))
                    )
                    .onConflictDoNothing();
            }
        }

        await tx
            .update(workspaceInvitations)
            .set({ acceptedAt: new Date(), acceptedByUserId: userPk })
            .where(eq(workspaceInvitations.id, row.id));

        await recordAuditEvent(tx, {
            companyId: row.companyId,
            actorUserId: user.authUserId,
            action: "member.joined",
            targetType: "member",
            targetId: userPk,
            detail: { via: "invitation", invitationId: row.id, role, alreadyMember },
        });

        return {
            success: true,
            companyId: Number(row.companyId),
            redirectTo: "/employer/documents",
            alreadyMember,
        };
    });
}
