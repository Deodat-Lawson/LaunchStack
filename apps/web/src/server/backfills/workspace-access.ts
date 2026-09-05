/**
 * Bring pre-roles rows into the workspace-access vocabulary.
 *
 * Three rewrites, each idempotent:
 *
 *   1. Accounts the legacy global `users.status` still marks `pending` get a
 *      `pending` membership in their workspace, so approval keeps meaning
 *      something now that only the membership row is read.
 *   2. Memberships in the retired `editor` role become `member`.
 *   3. Join links minted under the old `employer` / `employee` (and, from an
 *      old bug, `owner`) vocabulary hand out `admin` / `member` / `admin`.
 *
 * Invoked through the backfill registry:
 *   pnpm --filter @launchstack/web db:backfill --only=2026-09-workspace-access
 *
 * `sql/workspace-access.sql` is the SQL twin of this file.
 */

import { sql } from "drizzle-orm";

import type { DbClient } from "@launchstack/store/client";

type QueryResult = {
    count?: number;
    rowCount?: number;
    rows?: Array<Record<string, unknown>>;
};

function resultCount(result: unknown): number {
    const queryResult = result as QueryResult;
    const rows = Array.isArray(result)
        ? (result as Array<Record<string, unknown>>)
        : queryResult.rows;
    const count = rows?.[0]?.count;
    return count === undefined
        ? Number(queryResult.count ?? queryResult.rowCount ?? 0)
        : Number(count);
}

/** Active memberships whose account the legacy global status still holds as pending. */
export async function countMembershipsToMarkPending(db: DbClient): Promise<number> {
    return resultCount(
        await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM pdr_ai_v2_user_company_memberships m
      JOIN pdr_ai_v2_users u ON u.id = m.user_id
      WHERE u.status = 'pending'
        AND m.status = 'active'
    `)
    );
}

export async function countEditorMemberships(db: DbClient): Promise<number> {
    return resultCount(
        await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM pdr_ai_v2_user_company_memberships
      WHERE role = 'editor'
    `)
    );
}

export async function countLegacyJoinLinkRoles(db: DbClient): Promise<number> {
    return resultCount(
        await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM pdr_ai_v2_invite_codes
      WHERE role IN ('employer', 'employee', 'owner')
    `)
    );
}

/** Rows still needing any of the three rewrites. */
export async function countWorkspaceAccessRows(db: DbClient): Promise<number> {
    const [pending, editors, links] = await Promise.all([
        countMembershipsToMarkPending(db),
        countEditorMemberships(db),
        countLegacyJoinLinkRoles(db),
    ]);
    return pending + editors + links;
}

export async function applyWorkspaceAccessBackfill(db: DbClient): Promise<void> {
    console.log("[backfill-workspace-access] Starting...");

    await db.transaction(async tx => {
        await tx.execute(sql`
      UPDATE pdr_ai_v2_user_company_memberships m
         SET status = 'pending'
        FROM pdr_ai_v2_users u
       WHERE u.id = m.user_id
         AND u.status = 'pending'
         AND m.status = 'active'
    `);

        await tx.execute(sql`
      UPDATE pdr_ai_v2_user_company_memberships
         SET role = 'member'
       WHERE role = 'editor'
    `);

        await tx.execute(sql`
      UPDATE pdr_ai_v2_invite_codes
         SET role = CASE role
                      WHEN 'employer' THEN 'admin'
                      WHEN 'employee' THEN 'member'
                      WHEN 'owner' THEN 'admin'
                      ELSE role
                    END
       WHERE role IN ('employer', 'employee', 'owner')
    `);
    });

    console.log("[backfill-workspace-access] Done.");
}
