import { type Backfill } from "@launchstack/store/backfills";
import { getTableName, sql } from "drizzle-orm";

import { fillMissingPictures } from "@launchstack/pipelines/distribution/pictures";
import { partnerOrgs } from "@launchstack/pipelines/schema";
import { fetchReadable } from "@launchstack/tools/web-research";

function rowsOf<T>(result: unknown): T[] {
    return Array.isArray(result) ? (result as T[]) : ((result as { rows?: T[] }).rows ?? []);
}

const pendingWhere = () => sql`
    domain IS NOT NULL AND image_url IS NULL AND icon_url IS NULL AND pictures_checked_at IS NULL`;

/**
 * Pictures for Prospects companies saved before cards had them: each one's
 * homepage share image and icon, else its /favicon.ico, read through the
 * guarded reader. Every company checked is stamped, found or not, so a
 * re-run moves on instead of reading the same sites again.
 */
export const prospectPicturesBackfill: Backfill = {
    id: "2026-11-prospect-pictures",
    description: "Fetch homepage pictures for Prospects companies that have none",

    async estimate({ db }) {
        const rows = rowsOf<{ n: number }>(
            await db.execute(
                sql`SELECT count(*)::int AS n FROM ${sql.identifier(getTableName(partnerOrgs))} WHERE ${pendingWhere()}`
            )
        );
        return rows[0]?.n ?? 0;
    },

    async step({ db, batchSize }) {
        const companies = rowsOf<{ company_id: string }>(
            await db.execute(
                sql`SELECT DISTINCT company_id::text FROM ${sql.identifier(getTableName(partnerOrgs))} WHERE ${pendingWhere()} LIMIT 20`
            )
        );
        if (companies.length === 0) return { cursor: null, processed: 0 };
        let processed = 0;
        for (const { company_id } of companies) {
            const { checked } = await fillMissingPictures(
                BigInt(company_id),
                url => fetchReadable(url, { timeoutMs: 10_000 }),
                { limit: batchSize }
            );
            processed += checked;
        }
        // Checked rows are stamped, so the next step sees only what is left.
        return { cursor: processed > 0 ? "more" : null, processed };
    },
};
