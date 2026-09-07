/**
 * The audit log writer.
 *
 * Append-only, and written inside the same transaction as the change it
 * records, so a grant without its audit row cannot exist. The action
 * vocabulary is closed so the log can be filtered and exported.
 */

import type { DbClient } from "@launchstack/store/client";

import { workspaceAuditEvents } from "~/server/db/schema";

import type { AuditAction } from "./audit-actions";

export { AUDIT_ACTIONS, isAuditAction, type AuditAction } from "./audit-actions";

export type AuditTargetType =
    | "member"
    | "invitation"
    | "join_link"
    | "group"
    | "role"
    | "folder"
    | "document"
    | "connector"
    | "workspace";

export interface AuditEventInput {
    companyId: bigint;
    /** Auth subject id of the person making the change. */
    actorUserId: string;
    action: AuditAction;
    targetType: AuditTargetType;
    targetId?: string | number | bigint | null;
    detail?: Record<string, unknown>;
}

type Transaction = Parameters<Parameters<DbClient["transaction"]>[0]>[0];

/** Either the shared client or the transaction the change is being made in. */
export type AuditExecutor = Pick<DbClient, "insert"> | Pick<Transaction, "insert">;

export async function recordAuditEvent(
    executor: AuditExecutor,
    event: AuditEventInput
): Promise<void> {
    await executor.insert(workspaceAuditEvents).values({
        companyId: event.companyId,
        actorUserId: event.actorUserId,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId == null ? null : String(event.targetId),
        detail: event.detail ?? null,
    });
}
