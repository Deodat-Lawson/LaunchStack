/**
 * Join links (`invite_codes`): a shareable `/join/<code>` link that mints a
 * membership in the role it carries. The link is the admin's approval, so
 * the membership is active at once — unless the link was made with
 * `requiresApproval`, in which case it lands pending.
 */

import { randomBytes } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";

import { company } from "@launchstack/store/schema";
import { db } from "~/server/db";
import { inviteCodes, userCompanyMemberships } from "~/server/db/schema";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { recordAuditEvent } from "~/lib/authz/audit";
import { normalizeRoleSlug, roleLabel } from "~/lib/authz/permissions";
import { resolveRole } from "~/lib/authz/resolve";

import { workspaceLooks } from "~/server/profile/store";

import { conflict, gone, notFound } from "./errors";
import { customRoleNames, displayRoleName, requireAssignableRole } from "./roles";
import type { SessionUser } from "./session";
import { ensureUserRow } from "./user-row";

export interface JoinLinkView {
    id: number;
    code: string;
    role: string;
    roleName: string;
    isActive: boolean;
    /** Always true for a legacy short code, whatever the stored flag says. */
    requiresApproval: boolean;
    /** An 8-character code from before links could admit straight in. */
    legacy: boolean;
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
    requiresApproval?: boolean;
    /** Who made the link, as they appear in that workspace; null if unknown. */
    invitedBy?: string | null;
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
    requiresApproval: boolean;
}

const PROBLEM_MESSAGES: Record<JoinLinkProblem, string> = {
    unknown: "This join link is not valid.",
    expired: "This join link has expired.",
    exhausted: "This join link has reached its use limit.",
    inactive: "This join link was revoked.",
};

/** Longest code accepted from a request; issued codes are 32, legacy ones 8. */
export const JOIN_CODE_MAX_LENGTH = 64;

export function joinLinkUrl(origin: string, code: string): string {
    return `${origin}/join/${encodeURIComponent(code.toLowerCase())}`;
}

export function normalizeJoinCode(code: string): string {
    return code.trim().toUpperCase();
}

/** 128 bits: a link that admits people straight in must not be guessable. */
export function newJoinCode(): string {
    return randomBytes(16).toString("hex").toUpperCase();
}

/**
 * The 8-character codes issued before this release: 32 bits, few enough to
 * guess, so such a link never admits anyone straight in — whoever uses it
 * waits for approval. Resetting it issues a long code that can.
 */
export function isLegacyJoinCode(code: string): boolean {
    return normalizeJoinCode(code).length < 32;
}

/** Whether people who use this link wait on the pending list. */
function needsApproval(row: { code: string; requiresApproval: boolean }): boolean {
    return row.requiresApproval || isLegacyJoinCode(row.code);
}

export const LEGACY_LINK_MESSAGE =
    "This is an old short link that could be guessed, so it can't let people straight in. Reset it to get a new link that can.";

const DAY_MS = 24 * 60 * 60 * 1000;

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
            requiresApproval: needsApproval(row),
            legacy: isLegacyJoinCode(row.code),
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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface NewLink {
    role: string;
    expiresAt: Date | null;
    maxUses: number | null;
    requiresApproval: boolean;
}

async function insertLink(
    tx: Tx,
    ctx: WorkspaceContext,
    link: NewLink,
    replaces?: number
): Promise<JoinLinkRow> {
    const code = newJoinCode();
    const [inserted] = await tx
        .insert(inviteCodes)
        .values({
            code,
            companyId: ctx.companyId,
            role: link.role,
            createdBy: ctx.authUserId,
            expiresAt: link.expiresAt,
            maxUses: link.maxUses,
            requiresApproval: link.requiresApproval,
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
            // Only a prefix: the audit log is readable by more people than
            // may hold a working link.
            code: code.slice(0, 6),
            role: link.role,
            expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
            maxUses: link.maxUses,
            requiresApproval: link.requiresApproval,
            ...(replaces !== undefined ? { replaces } : {}),
        },
    });
    return inserted;
}

async function loadLink(companyId: bigint, id: number): Promise<JoinLinkRow> {
    const [row] = await db
        .select()
        .from(inviteCodes)
        .where(and(eq(inviteCodes.companyId, companyId), eq(inviteCodes.id, id)))
        .limit(1);
    if (!row) throw notFound("Join link not found.");
    return row;
}

async function oneView(ctx: WorkspaceContext, row: JoinLinkRow, origin: string) {
    const [link] = await toViews(ctx.companyId, [row], origin);
    if (!link) throw new Error("Join link view missing");
    return link;
}

export async function createJoinLink(
    ctx: WorkspaceContext,
    input: {
        role: string;
        expiresInDays?: number | null;
        maxUses?: number | null;
        requiresApproval?: boolean;
    },
    origin: string
): Promise<JoinLinkView> {
    const role = await requireAssignableRole(ctx, input.role);
    const row = await db.transaction(tx =>
        insertLink(tx, ctx, {
            role: role.slug,
            expiresAt:
                input.expiresInDays == null
                    ? null
                    : new Date(Date.now() + input.expiresInDays * DAY_MS),
            maxUses: input.maxUses ?? null,
            requiresApproval: input.requiresApproval ?? false,
        })
    );
    return oneView(ctx, row, origin);
}

/**
 * Change who a live link admits and how. The URL stays the same, so people
 * already holding it get the new terms.
 */
export async function updateJoinLink(
    ctx: WorkspaceContext,
    id: number,
    patch: { role?: string; requiresApproval?: boolean },
    origin: string
): Promise<JoinLinkView> {
    const row = await loadLink(ctx.companyId, id);
    if (!row.isActive) throw conflict("This join link was revoked. Create a new one instead.");
    // Re-checked for the role the link already carries too: someone who may
    // not hand out Admin must not flip an Admin link to skip approval.
    await requireAssignableRole(ctx, row.role);
    const role = patch.role !== undefined ? await requireAssignableRole(ctx, patch.role) : null;

    const set: Partial<{ role: string; requiresApproval: boolean }> = {};
    if (role && role.slug !== normalizeRoleSlug(row.role)) set.role = role.slug;
    if (patch.requiresApproval === false && isLegacyJoinCode(row.code)) {
        throw conflict(LEGACY_LINK_MESSAGE);
    }
    if (patch.requiresApproval !== undefined && patch.requiresApproval !== row.requiresApproval) {
        set.requiresApproval = patch.requiresApproval;
    }
    if (Object.keys(set).length === 0) return oneView(ctx, row, origin);

    await db.transaction(async tx => {
        await tx.update(inviteCodes).set(set).where(eq(inviteCodes.id, id));
        await recordAuditEvent(tx, {
            companyId: ctx.companyId,
            actorUserId: ctx.authUserId,
            action: "join_link.updated",
            targetType: "join_link",
            targetId: id,
            detail: set,
        });
    });
    return oneView(ctx, { ...row, ...set }, origin);
}

/**
 * Swap a link for a fresh code with the same terms — what an admin does when
 * a link has gone further than they meant. The old URL stops working in the
 * same transaction the new one starts. An expiry keeps its length, counted
 * from now; the use count starts over.
 */
export async function resetJoinLink(
    ctx: WorkspaceContext,
    id: number,
    origin: string
): Promise<JoinLinkView> {
    const old = await loadLink(ctx.companyId, id);
    if (!old.isActive) throw conflict("This join link was already revoked.");
    const role = await requireAssignableRole(ctx, old.role);
    const lifetime = old.expiresAt ? old.expiresAt.getTime() - old.createdAt.getTime() : null;

    const row = await db.transaction(async tx => {
        await tx.update(inviteCodes).set({ isActive: false }).where(eq(inviteCodes.id, id));
        await recordAuditEvent(tx, {
            companyId: ctx.companyId,
            actorUserId: ctx.authUserId,
            action: "join_link.revoked",
            targetType: "join_link",
            targetId: id,
            detail: { code: old.code.slice(0, 6), reset: true },
        });
        return insertLink(
            tx,
            ctx,
            {
                role: role.slug,
                expiresAt:
                    lifetime === null ? null : new Date(Date.now() + Math.max(lifetime, DAY_MS)),
                maxUses: old.maxUses,
                requiresApproval: old.requiresApproval,
            },
            id
        );
    });
    return oneView(ctx, row, origin);
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
            detail: { code: row.code.slice(0, 6) },
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
            requiresApproval: inviteCodes.requiresApproval,
            createdBy: inviteCodes.createdBy,
            workspaceName: company.name,
        })
        .from(inviteCodes)
        .innerJoin(company, eq(company.id, inviteCodes.companyId))
        .where(eq(inviteCodes.code, normalizeJoinCode(code)))
        .limit(1);
    if (!row) return { valid: false, reason: "unknown" };

    const problem = joinLinkProblem(row);
    if (problem) return { valid: false, reason: problem };

    const [resolved, looks] = await Promise.all([
        resolveRole(row.companyId, row.role),
        workspaceLooks(row.companyId, [row.createdBy]),
    ]);
    const role = resolved.slug === "owner" ? "admin" : resolved.slug;
    const inviter = looks.get(row.createdBy);
    return {
        valid: true,
        workspaceName: row.workspaceName,
        role,
        roleName: roleLabel(role, resolved.name),
        requiresApproval: needsApproval({ code, requiresApproval: row.requiresApproval }),
        // The page is public: a name, never the email the look falls back to.
        invitedBy: inviter && inviter.displayName !== inviter.email ? inviter.displayName : null,
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

        // Someone already waiting for approval who is handed a straight-in
        // link is let in by it — that link is the admin's approval.
        const activatesPending = membership?.status === "pending" && !needsApproval(row);
        if (membership && !activatesPending) {
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

        // Claim a use first, conditionally, so two people racing for the
        // last seat on a capped link can't both get in.
        const claimed = await tx
            .update(inviteCodes)
            .set({ useCount: sql`${inviteCodes.useCount} + 1` })
            .where(
                and(
                    eq(inviteCodes.id, row.id),
                    eq(inviteCodes.isActive, true),
                    sql`(${inviteCodes.maxUses} is null or ${inviteCodes.useCount} < ${inviteCodes.maxUses})`
                )
            )
            .returning({ id: inviteCodes.id });
        if (claimed.length === 0) throw gone(PROBLEM_MESSAGES.exhausted);

        const status = needsApproval(row) ? "pending" : "active";
        if (activatesPending) {
            await tx
                .update(userCompanyMemberships)
                .set({ role, status })
                .where(
                    and(
                        eq(userCompanyMemberships.userId, userPk),
                        eq(userCompanyMemberships.companyId, row.companyId)
                    )
                );
        } else {
            await tx.insert(userCompanyMemberships).values({
                userId: userPk,
                companyId: row.companyId,
                role,
                status,
            });
        }
        await recordAuditEvent(tx, {
            companyId: row.companyId,
            actorUserId: user.authUserId,
            action: "member.joined",
            targetType: "member",
            targetId: userPk,
            detail: {
                via: "join_link",
                code: row.code.slice(0, 6),
                status,
                role,
                ...(activatesPending ? { wasPending: true } : {}),
            },
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
