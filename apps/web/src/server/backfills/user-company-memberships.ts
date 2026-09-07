/**
 * Provision `user_company_memberships` for users who predate the table.
 *
 * `resolveActiveCompanyForUser` resolves a verified user's workspace from
 * membership rows only, and `requireWorkspaceContext` refuses a context with
 * no membership — deliberately, so a membership miss can never fall back to
 * the legacy global `users.role` and hand out a role nobody granted for that
 * tenant. The consequence is that accounts created before the memberships
 * table existed get 403 from every product API until a row exists.
 *
 * This backfill creates that row from the only evidence those accounts carry:
 * the legacy default-workspace pointer (`users.company_id`) and the legacy
 * global role (`users.role`).
 *
 * Invoked through the backfill registry:
 *   pnpm --filter @launchstack/web db:backfill --only=2026-08-user-company-memberships
 *
 * `sql/user-company-memberships.sql` is the SQL twin of this function.
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

/**
 * Verified users holding a default company but no membership for it — exactly
 * the population that resolves to a null workspace today.
 */
export async function countUsersMissingMembership(db: DbClient): Promise<number> {
    return resultCount(
        await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM pdr_ai_v2_users u
      LEFT JOIN pdr_ai_v2_user_company_memberships m
        ON m.user_id = u.id
       AND m.company_id = u.company_id
      WHERE u.status = 'verified'
        AND u.company_id IS NOT NULL
        AND m.id IS NULL
    `)
    );
}

/**
 * Idempotent: `ON CONFLICT DO NOTHING` leaves existing rows untouched, so a
 * role someone changed deliberately survives a re-run.
 *
 * Role vocabularies differ — `users.role` is employer/employee while the
 * membership role is owner/admin/editor (see ~/lib/authz/permissions) — so the
 * mapping mirrors what the signup routes already write.
 */
export async function provisionMissingMemberships(db: DbClient): Promise<void> {
    console.log("[backfill-user-company-memberships] Starting...");

    await db.execute(sql`
    INSERT INTO pdr_ai_v2_user_company_memberships (user_id, company_id, role)
    SELECT
        u.id,
        u.company_id,
        CASE u.role
            WHEN 'employer' THEN 'owner'
            WHEN 'owner' THEN 'owner'
            WHEN 'admin' THEN 'admin'
            ELSE 'editor'
        END
    FROM pdr_ai_v2_users u
    WHERE u.status = 'verified'
      AND u.company_id IS NOT NULL
    ON CONFLICT (user_id, company_id) DO NOTHING
  `);

    console.log("[backfill-user-company-memberships] Done.");
}
