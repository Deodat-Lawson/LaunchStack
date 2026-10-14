/**
 * Workspace settings. A workspace with no row has the defaults; the row is
 * created on the first change.
 */

import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { workspaceSettings } from "~/server/db/schema";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { recordAuditEvent } from "~/lib/authz/audit";

import type { Executor } from "./db-types";

/**
 * Whether join links need approval used to live here as `joinPolicy`; it is
 * per link now (`invite_codes.requires_approval`), and the column is unread.
 */
export interface SettingsView {
    auditRetentionDays: number | null;
}

export const DEFAULT_SETTINGS: SettingsView = { auditRetentionDays: null };

export async function loadSettings(executor: Executor, companyId: bigint): Promise<SettingsView> {
    const [row] = await executor
        .select({ auditRetentionDays: workspaceSettings.auditRetentionDays })
        .from(workspaceSettings)
        .where(eq(workspaceSettings.companyId, companyId))
        .limit(1);
    if (!row) return { ...DEFAULT_SETTINGS };
    return { auditRetentionDays: row.auditRetentionDays ?? null };
}

export function getSettings(ctx: WorkspaceContext): Promise<SettingsView> {
    return loadSettings(db, ctx.companyId);
}

export async function updateSettings(
    ctx: WorkspaceContext,
    patch: { auditRetentionDays?: number | null }
): Promise<SettingsView> {
    const current = await loadSettings(db, ctx.companyId);
    const next: SettingsView = {
        auditRetentionDays:
            patch.auditRetentionDays === undefined
                ? current.auditRetentionDays
                : patch.auditRetentionDays,
    };

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (next.auditRetentionDays !== current.auditRetentionDays) {
        changes.auditRetentionDays = {
            from: current.auditRetentionDays,
            to: next.auditRetentionDays,
        };
    }
    if (Object.keys(changes).length === 0) return current;

    await db.transaction(async tx => {
        const [existing] = await tx
            .select({ companyId: workspaceSettings.companyId })
            .from(workspaceSettings)
            .where(eq(workspaceSettings.companyId, ctx.companyId))
            .limit(1);
        if (existing) {
            await tx
                .update(workspaceSettings)
                .set(next)
                .where(eq(workspaceSettings.companyId, ctx.companyId));
        } else {
            await tx.insert(workspaceSettings).values({ companyId: ctx.companyId, ...next });
        }
        await recordAuditEvent(tx, {
            companyId: ctx.companyId,
            actorUserId: ctx.authUserId,
            action: "settings.changed",
            targetType: "workspace",
            targetId: ctx.companyId,
            detail: { changes },
        });
    });

    return next;
}
