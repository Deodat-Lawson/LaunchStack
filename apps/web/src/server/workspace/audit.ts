/**
 * Reading the audit log: keyset-paginated JSON, or the same filter as CSV.
 */

import { and, desc, eq, gte, lt, lte } from "drizzle-orm";

import { db } from "~/server/db";
import { users, workspaceAuditEvents } from "~/server/db/schema";
import type { WorkspaceContext } from "~/lib/require-workspace-context";

export interface AuditEventView {
    id: number;
    action: string;
    actor: { authUserId: string; name: string; email: string } | null;
    targetType: string;
    targetId: string | null;
    detail: Record<string, unknown> | null;
    createdAt: string;
}

export interface AuditQuery {
    cursor?: number;
    limit?: number;
    action?: string;
    /** Auth subject id of the actor. */
    actor?: string;
    from?: Date;
    to?: Date;
}

export const AUDIT_DEFAULT_LIMIT = 50;
export const AUDIT_MAX_LIMIT = 200;
const CSV_PAGE = 500;
const CSV_MAX_ROWS = 20_000;

async function page(
    companyId: bigint,
    query: AuditQuery,
    limit: number
): Promise<AuditEventView[]> {
    const rows = await db
        .select({
            id: workspaceAuditEvents.id,
            action: workspaceAuditEvents.action,
            actorUserId: workspaceAuditEvents.actorUserId,
            actorName: users.name,
            actorEmail: users.email,
            targetType: workspaceAuditEvents.targetType,
            targetId: workspaceAuditEvents.targetId,
            detail: workspaceAuditEvents.detail,
            createdAt: workspaceAuditEvents.createdAt,
        })
        .from(workspaceAuditEvents)
        .leftJoin(users, eq(users.userId, workspaceAuditEvents.actorUserId))
        .where(
            and(
                eq(workspaceAuditEvents.companyId, companyId),
                query.cursor !== undefined ? lt(workspaceAuditEvents.id, query.cursor) : undefined,
                query.action ? eq(workspaceAuditEvents.action, query.action) : undefined,
                query.actor ? eq(workspaceAuditEvents.actorUserId, query.actor) : undefined,
                query.from ? gte(workspaceAuditEvents.createdAt, query.from) : undefined,
                query.to ? lte(workspaceAuditEvents.createdAt, query.to) : undefined
            )
        )
        .orderBy(desc(workspaceAuditEvents.id))
        .limit(limit);

    return rows.map(row => ({
        id: Number(row.id),
        action: row.action,
        actor: {
            authUserId: row.actorUserId,
            name: row.actorName ?? "Unknown user",
            email: row.actorEmail ?? "",
        },
        targetType: row.targetType,
        targetId: row.targetId ?? null,
        detail: row.detail ?? null,
        createdAt: row.createdAt.toISOString(),
    }));
}

export async function listAuditEvents(
    ctx: WorkspaceContext,
    query: AuditQuery
): Promise<{ events: AuditEventView[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(query.limit ?? AUDIT_DEFAULT_LIMIT, 1), AUDIT_MAX_LIMIT);
    const rows = await page(ctx.companyId, query, limit + 1);
    const hasMore = rows.length > limit;
    const events = hasMore ? rows.slice(0, limit) : rows;
    const last = events[events.length - 1];
    return { events, nextCursor: hasMore && last ? String(last.id) : null };
}

function csvCell(value: unknown): string {
    const text = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function exportAuditCsv(ctx: WorkspaceContext, query: AuditQuery): Promise<string> {
    const lines = [
        "id,createdAt,action,actorName,actorEmail,actorUserId,targetType,targetId,detail",
    ];
    let cursor = query.cursor;
    let total = 0;
    while (total < CSV_MAX_ROWS) {
        const size = Math.min(CSV_PAGE, CSV_MAX_ROWS - total);
        const rows = await page(ctx.companyId, { ...query, cursor }, size);
        for (const row of rows) {
            lines.push(
                [
                    row.id,
                    row.createdAt,
                    row.action,
                    row.actor?.name,
                    row.actor?.email,
                    row.actor?.authUserId,
                    row.targetType,
                    row.targetId,
                    row.detail,
                ]
                    .map(csvCell)
                    .join(",")
            );
        }
        total += rows.length;
        const last = rows[rows.length - 1];
        if (!last || rows.length < size) break;
        cursor = last.id;
    }
    return `${lines.join("\r\n")}\r\n`;
}
