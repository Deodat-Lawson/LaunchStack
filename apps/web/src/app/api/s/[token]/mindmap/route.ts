/**
 * GET /api/s/<token>/mindmap — the map behind a shared mindmap document, as
 * it was when that copy was published (the revision its marker records),
 * never the live draft: edits made since are not public until published.
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

            const [found] = await db
                .select({
                    title: mindmaps.title,
                    templateId: mindmaps.templateId,
                    docVersion: mindmaps.docVersion,
                    doc: mindmapRevisions.doc,
                })
                .from(mindmapRevisions)
                .innerJoin(mindmaps, eq(mindmaps.id, mindmapRevisions.mindmapId))
                .where(
                    and(
                        eq(mindmapRevisions.mindmapId, mindmapId),
                        eq(mindmapRevisions.revision, revision),
                        eq(mindmaps.companyId, link.companyId)
                    )
                )
                .limit(1);
            if (!found) return publicError(request, 404, "noMindmap");

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
