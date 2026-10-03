/**
 * Mark the website sources saved before the importers wrote a marker.
 *
 * The viewer shows a saved web page by `ocrMetadata.kind = "website"`
 * (`~/lib/website-document`): its address, a way to open it, and the text read
 * from it. Without the marker the page's HTML is framed with scripts off,
 * which for most company sites is a white page. Nothing else on the document
 * row says it came from a website: the creation key is stored hashed and the
 * file is plain HTML. The outbox does: each import's `source.version.created`
 * event carries `isWebsite: true` and the raw creation key as
 * `archiveIdentity`, `website:<url>` for a page and `crawl:<group>:<url>` for
 * a crawled one.
 *
 * The marker is merged into `ocrMetadata`, never written over it, and a row
 * that already has a `kind` (any marker) is left alone, so a re-run changes
 * nothing.
 *
 * Invoked through the backfill registry:
 *   pnpm --filter @launchstack/web db:backfill --only=2026-10-website-source-markers
 */

import { getTableName, sql } from "drizzle-orm";

import type { DbClient } from "@launchstack/store/client";
import { document, eventOutbox } from "@launchstack/store/schema";

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

/** The importers' raw creation keys: what comes before the page's address. */
const IDENTITY_PREFIX = String.raw`^(website:|crawl:[^:]+:)`;
const IDENTITY_WITH_URL = String.raw`^(website:|crawl:[^:]+:)https?://`;

/** Website imports whose document row has no marker yet, with the page's address. */
const unmarked = () => sql`
  SELECT DISTINCT ON (d.id)
         d.id AS document_id,
         regexp_replace(o.payload->'payload'->>'archiveIdentity', ${IDENTITY_PREFIX}, '') AS url,
         d.created_at AS created_at
    FROM ${sql.identifier(getTableName(eventOutbox))} o
    JOIN ${sql.identifier(getTableName(document))} d
      ON d.id = (o.payload->'payload'->>'sourceId')::bigint
     AND d.company_id = o.company_id
   WHERE o.event_type = 'source.version.created'
     AND o.payload->'payload'->>'isWebsite' = 'true'
     AND o.payload->'payload'->>'archiveIdentity' ~ ${IDENTITY_WITH_URL}
     AND (d.ocr_metadata IS NULL OR jsonb_typeof(d.ocr_metadata) = 'object')
     AND d.ocr_metadata->>'kind' IS NULL
   ORDER BY d.id, o.id
`;

export async function countUnmarkedWebsiteSources(db: DbClient): Promise<number> {
    return resultCount(await db.execute(sql`SELECT count(*)::int AS count FROM (${unmarked()}) t`));
}

/** One set-based statement; safe to re-run. */
export async function markWebsiteSources(db: DbClient): Promise<void> {
    await db.execute(sql`
      WITH pending AS (${unmarked()})
      UPDATE ${sql.identifier(getTableName(document))} d
         SET ocr_metadata = coalesce(d.ocr_metadata, '{}'::jsonb) || jsonb_build_object(
               'kind', 'website',
               'url', p.url,
               'capturedAt', to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
             )
        FROM pending p
       WHERE d.id = p.document_id
    `);
}
