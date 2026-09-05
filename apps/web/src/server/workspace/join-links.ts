/**
 * Join links (`invite_codes`): a shareable code that mints a membership in
 * the role it carries. Under the default `approval` policy the membership
 * lands pending; under `open` it is active at once.
 */

import { randomBytes } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";

import { company } from "@launchstack/store/schema";
import { db } from "~/server/db";
import { inviteCodes, userCompanyMemberships } from "~/server/db/schema";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { recordAuditEvent } from "~/lib/authz/audit";
import { normalizeRoleSlug, roleLabel, type JoinPolicy } from "~/lib/authz/permissions";
import { resolveRole } from "~/lib/authz/resolve";

import { conflict, gone, notFound } from "./errors";
import { customRoleNames, displayRoleName, requireAssignableRole } from "./roles";
import type { SessionUser } from "./session";
import { loadSettings } from "./settings";
import { ensureUserRow } from "./user-row";

export interface JoinLinkView {
    id: number;
    code: string;
    role: string;
    roleName: string;
    isActive: boolean;
    createdAt: string;
    expiresAt: string | null;
    maxUses: number | null;
    useCount: number;
    url: string;
}

export type JoinLinkProblem = "unknown" | "expired" | "exhausted" | "inactive";

export interface JoinLinkPreview {
    valid: boolean;
    reason?: JoinLinkProblem;
    workspaceName?: string;
    role?: string;
    roleName?: string;
    joinPolicy?: JoinPolicy;
}

export interface JoinResult {
    success: true;
    status: "pending" | "active";
    companyId: number;
    redirectTo: string;
    alreadyMember: boolean;
}

interface JoinLinkRow {
    id: number;
    code: string;
    companyId: bigint;
    role: string;
    isActive: boolean;
    createdAt: Date;
    expiresAt: Date | null;
    maxUses: number | null;
    useCount: number;
}

const PROBLEM_MESSAGES: Record<JoinLinkProblem, string> = {
    unknown: "This join link is not valid.",
    expired: "This join link has expired.",
    exhausted: "This join link has reached its use limit.",
    inactive: "This join link was revoked.",
};

export function joinLinkUrl(origin: string, code: string): string {
    return `${origin}/signup?code=${encodeURIComponent(code)}`;
}

export function normalizeJoinCode(code: string): string {
    return code.trim().toUpperCase();
}

function newCode(): string {
    return randomBytes(4).toString("hex").toUpperCase();
}

export function joinLinkProblem(
    row: { isActive: boolean; expiresAt: Date | null; maxUses: number | null; useCount: number },
    now: Date = new Date()
): JoinLinkProblem | null {
    if (!row.isActive) return "inactive";
    if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return "expired";
    if (row.maxUses !== null && row.useCount >= row.maxUses) return "exhausted";
    return null;
}

function redirectFor(status: "pending" | "active"): string {
    return status === "pending" ? "/employer/pending-approval" : "/employer/documents";
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

async function toViews(
    companyId: bigint,
    rows: JoinLinkRow[],
    origin: string
): Promise<JoinLinkView[]> {
    const names = await customRoleNames(companyId);
    return rows.map(row => {
        const role = normalizeRoleSlug(row.role);
        return {
            id: Number(row.id),
            code: row.code,
            role,
            roleName: displayRoleName(role, names),
            isActive: row.isActive,
            createdAt: row.createdAt.toISOString(),
            expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
            maxUses: row.maxUses ?? null,
            useCount: row.useCount,
            url: joinLinkUrl(origin, row.code),
        };
    });
}

export async function listJoinLinks(
    ctx: WorkspaceContext,
    origin: string
): Promise<JoinLinkView[]> {
    const rows = await db
        .select()
        .from(inviteCodes)
        .where(and(eq(inviteCodes.companyId, ctx.companyId), eq(inviteCodes.isActive, true)))
        .orderBy(desc(inviteCodes.id));
    return toViews(ctx.companyId, rows, origin);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createJoinLink(
    ctx: WorkspaceContext,
    input: { role: string; expiresInDays?: number | null; maxUses?: number | null },
    origin: string
): Promise<JoinLinkView> {
    const role = await requireAssignableRole(ctx, input.role);
    const code = newCode();
    const expiresAt =
        input.expiresInDays == null
            ? null
            : new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);
    const maxUses = input.maxUses ?? null;

    const row = await db.transaction(async tx => {
        const [inserted] = await tx
            .insert(inviteCodes)
            .values({
                code,
                companyId: ctx.companyId,
                role: role.slug,
                createdBy: ctx.authUserId,
                expiresAt,
                maxUses,
            })
            .returning();
        if (!inserted) throw new Error("Join link insert returned no row");
        await recordAuditEvent(tx, {
            companyId: ctx.companyId,
            actorUserId: ctx.authUserId,
            action: "join_link.created",
            targetType: "join_link",
            targetId: inserted.id,
            detail: {
                code,
                role: role.slug,
                expiresAt: expiresAt ? expiresAt.toISOString() : null,
                maxUses,
            },
        });
        return inserted;
    });

    const [link] = await toViews(ctx.companyId, [row], origin);
    if (!link) throw new Error("Join link view missing");
    return link;
}

export async function revokeJoinLink(
    ctx: WorkspaceContext,
    id: number
): Promise<{ success: true }> {
    const [row] = await db
        .select({ id: inviteCodes.id, code: inviteCodes.code, isActive: inviteCodes.isActive })
        .from(inviteCodes)
        .where(and(eq(inviteCodes.companyId, ctx.companyId), eq(inviteCodes.id, id)))
        .limit(1);
    if (!row) throw notFound("Join link not found.");
    if (!row.isActive) return { success: true };

    await db.transaction(async tx => {
        await tx.update(inviteCodes).set({ isActive: false }).where(eq(inviteCodes.id, id));
        await recordAuditEvent(tx, {
            companyId: ctx.companyId,
            actorUserId: ctx.authUserId,
            action: "join_link.revoked",
            targetType: "join_link",
            targetId: id,
            detail: { code: row.code },
        });
    });
    return { success: true };
}

// ---------------------------------------------------------------------------
// The joiner's side
// ---------------------------------------------------------------------------

export async function previewJoinLink(code: string): Promise<JoinLinkPreview> {
    const [row] = await db
        .select({
            companyId: inviteCodes.companyId,
            role: inviteCodes.role,
            isActive: inviteCodes.isActive,
            expiresAt: inviteCodes.expiresAt,
            maxUses: inviteCodes.maxUses,
            useCount: inviteCodes.useCount,
            workspaceName: company.name,
        })
        .from(inviteCodes)
        .innerJoin(company, eq(company.id, inviteCodes.companyId))
        .where(eq(inviteCodes.code, normalizeJoinCode(code)))
        .limit(1);
    if (!row) return { valid: false, reason: "unknown" };

    const problem = joinLinkProblem(row);
    if (problem) return { valid: false, reason: problem };

    const [resolved, settings] = await Promise.all([
        resolveRole(row.companyId, row.role),
        loadSettings(db, row.companyId),
    ]);
    const role = resolved.slug === "owner" ? "admin" : resolved.slug;
    return {
        valid: true,
        workspaceName: row.workspaceName,
        role,
        roleName: roleLabel(role, resolved.name),
        joinPolicy: settings.joinPolicy,
    };
}

export async function acceptJoinLink(
    user: SessionUser,
    input: { code: string; name?: string | null }
): Promise<JoinResult> {
    const [row] = await db
        .select()
        .from(inviteCodes)
        .where(eq(inviteCodes.code, normalizeJoinCode(input.code)))
        .limit(1);
    if (!row) throw notFound(PROBLEM_MESSAGES.unknown);
    const problem = joinLinkProblem(row);
    if (problem) throw gone(PROBLEM_MESSAGES[problem]);

    const normalized = normalizeRoleSlug(row.role);
    const role = normalized === "owner" ? "admin" : normalized;

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

        if (membership) {
            if (membership.status === "suspended") {
                throw conflict("Your membership in this workspace is suspended.");
            }
            const status = membership.status === "pending" ? "pending" : "active";
            return {
                success: true,
                status,
                companyId: Number(row.companyId),
                redirectTo: redirectFor(status),
                alreadyMember: true,
            };
        }

        const settings = await loadSettings(tx, row.companyId);
        const status = settings.joinPolicy === "open" ? "active" : "pending";

        await tx.insert(userCompanyMemberships).values({
            userId: userPk,
            companyId: row.companyId,
            role,
            status,
        });
        await tx
            .update(inviteCodes)
            .set({ useCount: sql`${inviteCodes.useCount} + 1` })
            .where(eq(inviteCodes.id, row.id));
        await recordAuditEvent(tx, {
            companyId: row.companyId,
            actorUserId: user.authUserId,
            action: "member.joined",
            targetType: "member",
            targetId: userPk,
            detail: { via: "join_link", code: row.code, status, role },
        });

        return {
            success: true,
            status,
            companyId: Number(row.companyId),
            redirectTo: redirectFor(status),
            alreadyMember: false,
        };
    });
}
