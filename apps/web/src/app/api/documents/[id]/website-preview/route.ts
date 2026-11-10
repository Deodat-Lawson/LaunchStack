/**
 * GET /api/documents/:id/website-preview
 *
 * A picture of a saved website source: the page as it looked when it was
 * saved, top to bottom, as a WebP. The first request takes the screenshot
 * (Gotenberg, ADR-009) and stores it; later ones read the stored copy, and
 * revalidate against its ETag.
 *
 * Takes a document id, never a URL: the HTML that is rendered is looked up
 * server-side and scoped to the caller's workspace and folders, so a client
 * cannot point the renderer at anything else. Without a Gotenberg deployment
 * the route answers a typed 503 and the viewer falls back to the page text.
 */

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { RenderingServiceError } from "@launchstack/document-conversion-engine";
import { document } from "@launchstack/store/schema";

import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { websiteMarkerOf } from "~/lib/website-document";
import { db } from "~/server/db";
import { getGotenbergClient } from "~/server/rendering";
import {
    WEBSITE_PREVIEW_CONTENT_TYPE,
    WebsiteSourceUnreadableError,
    readStoredPreview,
    renderWebsitePreview,
    websitePreviewEtag,
    websitePreviewOf,
    type WebsitePreview,
} from "~/server/website-preview";

export const runtime = "nodejs";
// Chromium's first start plus a long page can take most of a minute.
export const maxDuration = 60;

interface RouteParams {
    params: Promise<{ id: string }>;
}

function fail(status: number, error: string, message: string): NextResponse {
    return NextResponse.json({ success: false, error, message }, { status });
}

function picture(preview: WebsitePreview): NextResponse {
    return new NextResponse(new Uint8Array(preview.image), {
        status: 200,
        headers: {
            "Content-Type": WEBSITE_PREVIEW_CONTENT_TYPE,
            "Content-Length": String(preview.image.byteLength),
            // Revalidate every time: a new version of the page is a new picture
            // behind the same address.
            "Cache-Control": "private, no-cache",
            ETag: websitePreviewEtag(preview.record),
            "X-Content-Type-Options": "nosniff",
            "X-Preview-Truncated": String(preview.record.truncated),
        },
    });
}

export async function GET(request: Request, { params }: RouteParams) {
    const locale = localeOfRequest(request);
    const t = translatorFor(locale, "viewers.server.errors");
    const api = translatorFor(locale, "errors.api");

    const documentId = Number((await params).id);
    if (!Number.isInteger(documentId) || documentId <= 0) {
        return fail(400, "invalid_request", api("invalidDocumentId"));
    }

    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    const companyId = ctx.data.companyId;

    const [row] = await db
        .select({ id: document.id, url: document.url, ocrMetadata: document.ocrMetadata })
        .from(document)
        .where(
            and(
                eq(document.id, documentId),
                scopedDocumentWhere(companyId, await ctx.data.documentScope())
            )
        );

    if (!row) {
        // Same answer whether it does not exist, belongs to another workspace,
        // or sits in a folder the caller cannot see.
        return fail(404, "not_found", api("documentNotFound"));
    }
    if (!websiteMarkerOf(row.ocrMetadata)) {
        return fail(415, "not_website", t("notWebsite"));
    }

    const stored = websitePreviewOf(row.ocrMetadata);
    const current = stored?.source === row.url ? stored : null;
    if (current) {
        const etag = websitePreviewEtag(current);
        if (request.headers.get("if-none-match") === etag) {
            return new NextResponse(null, {
                status: 304,
                headers: { ETag: etag, "Cache-Control": "private, no-cache" },
            });
        }
        const image = await readStoredPreview(current);
        if (image) return picture({ record: current, image });
        // The stored file is gone: take the picture again.
    }

    const gotenberg = getGotenbergClient();
    if (!gotenberg) return fail(503, "service_not_configured", t("previewNotConfigured"));

    try {
        const preview = await renderWebsitePreview({
            documentId,
            source: row.url,
            previous: stored,
            gotenberg,
            userId: ctx.data.authUserId,
            companyId,
        });
        return picture(preview);
    } catch (error) {
        if (error instanceof WebsiteSourceUnreadableError) {
            const sources = translatorFor(locale, "sources.server.errors");
            return fail(
                502,
                "fetch_failed",
                error.status
                    ? sources("storageReadHttp", { status: String(error.status) })
                    : sources("storageRead")
            );
        }
        if (error instanceof RenderingServiceError) {
            const trace = error.trace ? ` (trace ${error.trace})` : "";
            console.error(`[website-preview] render failed${trace}: ${error.detail}`);
            return fail(502, "rendering_failed", t("previewRenderFailed"));
        }
        console.error("[website-preview] failed:", error);
        return fail(500, "internal_error", t("previewRenderFailed"));
    }
}
