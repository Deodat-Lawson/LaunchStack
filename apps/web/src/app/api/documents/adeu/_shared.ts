/**
 * Shared loading and authorization for the Word editor's routes.
 *
 * Every route here takes a `documentId` rather than a URL. The document's
 * location is looked up server-side and scoped to the caller's company, so a
 * client can never point the editor at an arbitrary object — the old
 * apply-edits route accepted a base64 blob from the browser and had no idea
 * what document it belonged to.
 */

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { document } from "@launchstack/store/schema";
import type { Locale } from "~/i18n/locales";
import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { db } from "~/server/db";
import { fetchFile } from "~/lib/storage";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { scopedDocumentWhere } from "~/lib/authz/scope";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface LoadedDocument {
    id: number;
    title: string;
    url: string;
    filename: string;
    companyId: bigint;
    bytes: Buffer;
}

export type LoadResult =
    | { ok: true; data: LoadedDocument; companyId: bigint; userId: string }
    | { ok: false; response: NextResponse };

function fail(status: number, error: string, message?: string): NextResponse {
    return NextResponse.json({ success: false, error, message }, { status });
}

/** English without a request (a test, a script). */
function localeOf(request: Request | undefined): Locale {
    return request ? localeOfRequest(request) : "en";
}

/** Is this a Word document? The editor only handles DOCX. */
export function isDocx(fileType: string | null, mimeType: string | null, title: string): boolean {
    if (mimeType === DOCX_MIME) return true;
    if ((fileType ?? "").toLowerCase() === "docx") return true;
    return title.toLowerCase().endsWith(".docx");
}

/**
 * Resolve a document id to its bytes, enforcing company scope.
 *
 * `fetchOnly: false` skips the download for callers that only need metadata.
 */
export async function loadDocument(
    documentId: number,
    /** `request` words the refusals in its reader's language. */
    options?: { withBytes?: boolean; request?: Request }
): Promise<LoadResult> {
    const locale = localeOf(options?.request);
    const t = translatorFor(locale, "viewers.server.errors");
    const sources = translatorFor(locale, "sources.server.errors");
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return { ok: false, response: ctx.response };

    const companyId = BigInt(ctx.data.companyId);

    const [row] = await db
        .select({
            id: document.id,
            title: document.title,
            url: document.url,
            companyId: document.companyId,
            mimeType: document.mimeType,
            fileType: document.fileType,
        })
        .from(document)
        .where(
            and(
                eq(document.id, documentId),
                scopedDocumentWhere(companyId, await ctx.data.documentScope())
            )
        );

    if (!row) {
        // Same response whether it does not exist, belongs to another company,
        // or sits in a folder the caller cannot see — the distinction would
        // leak which ids are real.
        return {
            ok: false,
            response: fail(
                404,
                "not_found",
                translatorFor(locale, "errors.api")("documentNotFound")
            ),
        };
    }

    if (!isDocx(row.fileType, row.mimeType, row.title)) {
        return {
            ok: false,
            response: fail(415, "unsupported_type", t("wordOnlyDocx")),
        };
    }

    let bytes = Buffer.alloc(0);
    if (options?.withBytes !== false) {
        try {
            const res = await fetchFile(row.url);
            if (!res.ok) {
                return {
                    ok: false,
                    response: fail(
                        502,
                        "fetch_failed",
                        sources("storageReadHttp", { status: String(res.status) })
                    ),
                };
            }
            bytes = Buffer.from(await res.arrayBuffer());
        } catch (err) {
            return {
                ok: false,
                response: fail(
                    502,
                    "fetch_failed",
                    err instanceof Error ? err.message : sources("storageRead")
                ),
            };
        }
    }

    const filename = row.title.toLowerCase().endsWith(".docx") ? row.title : `${row.title}.docx`;

    return {
        ok: true,
        companyId,
        userId: ctx.data.authUserId,
        data: {
            id: row.id,
            title: row.title,
            url: row.url,
            filename,
            companyId: row.companyId,
            bytes,
        },
    };
}

/**
 * Translate an adeu client error into a response the editor can act on, in
 * the language of the person behind `request`. The service's own detail
 * passes through.
 */
export function adeuErrorResponse(err: unknown, request?: Request): NextResponse {
    const name = (err as { name?: string } | null)?.name;
    const locale = localeOf(request);

    if (name === "AdeuConfigError") {
        return fail(
            503,
            "service_not_configured",
            translatorFor(locale, "viewers.server.errors")("editingNotConfigured")
        );
    }

    if (name === "AdeuServiceError") {
        const e = err as { statusCode: number; detail: string };
        // 4xx from the service is the caller's problem and is worth showing
        // verbatim; anything else is an outage.
        const status = e.statusCode >= 400 && e.statusCode < 500 ? e.statusCode : 502;
        return fail(status, "editing_failed", e.detail);
    }

    return fail(
        500,
        "internal_error",
        err instanceof Error ? err.message : translatorFor(locale, "errors.api")("unknownError")
    );
}
