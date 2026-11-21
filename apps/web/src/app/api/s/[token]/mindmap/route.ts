/**
 * GET /api/s/<token>/mindmap — the map behind a shared mindmap document, as
 * it was when that copy was published (the revision its marker records):
 * that revision from the map's history, or the map itself while it is still
 * at that revision. Never edits made since: until they are published, the
 * viewer shows the published outline instead.
 * The shape is what the viewer's `getMindmap` returns (`{ mindmap }`), with
 * nothing about who made it or where it is filed.
 */

import { and, eq } from "drizzle-orm";

import { mindmapIdOf } from "~/lib/mindmap-document";
import { db } from "~/server/db";
import { mindmapRevisions, mindmaps } from "~/server/db/schema";
import {
    PUBLIC_READ_LIMIT,
    publicError,
    publicJson,
    publicShareRoute,
} from "~/server/public-share/http";

type Params = { params: Promise<{ token: string }> };

function publishedRevision(meta: Record<string, unknown> | null): number | null {
    const value = meta?.revision;
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

export async function GET(request: Request, { params }: Params) {
    return publicShareRoute(
        request,
        params,
        PUBLIC_READ_LIMIT,
        "mindmap",
        async ({ link, row }) => {
            const mindmapId = mindmapIdOf(row.ocrMetadata);
            const revision = publishedRevision(row.ocrMetadata);
            if (mindmapId === null || revision === null)
                return publicError(request, 404, "noMindmap");

            const [map] = await db
                .select({
                    templateId: mindmaps.templateId,
                    docVersion: mindmaps.docVersion,
                    revision: mindmaps.revision,
                    doc: mindmaps.doc,
                    snapshot: mindmapRevisions.doc,
                })
                .from(mindmaps)
                .leftJoin(
                    mindmapRevisions,
                    and(
                        eq(mindmapRevisions.mindmapId, mindmaps.id),
                        eq(mindmapRevisions.revision, revision)
                    )
                )
                .where(and(eq(mindmaps.id, mindmapId), eq(mindmaps.companyId, link.companyId)))
                .limit(1);
            // The published revision as kept in history, or the map itself
            // while nothing has been saved since it was published. Anything
            // else would be edits nobody published: the viewer falls back to
            // the published outline instead.
            const doc = map?.snapshot ?? (map && map.revision === revision ? map.doc : undefined);
            if (!map || doc === undefined || doc === null) {
                return publicError(request, 404, "noMindmap");
            }
            const found = { templateId: map.templateId, docVersion: map.docVersion, doc };

            return publicJson({
                mindmap: {
                    id: 0,
                    title: row.title,
                    templateId: found.templateId,
                    revision,
                    docVersion: found.docVersion,
                    doc: found.doc,
                },
            });
        }
    );
}
