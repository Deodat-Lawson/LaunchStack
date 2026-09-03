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
import { db } from "~/server/db";
import { fetchFile } from "~/lib/storage";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

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
    options?: { withBytes?: boolean }
): Promise<LoadResult> {
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
        .where(and(eq(document.id, documentId), eq(document.companyId, companyId)));

    if (!row) {
        // Same response whether it does not exist or belongs to another
        // company — the distinction would leak which ids are real.
        return { ok: false, response: fail(404, "not_found", "Document not found") };
    }

    if (!isDocx(row.fileType, row.mimeType, row.title)) {
        return {
            ok: false,
            response: fail(
                415,
                "unsupported_type",
                "The Word editor only opens .docx files. This document is a different format."
            ),
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
                        `Could not read the document from storage (HTTP ${res.status}).`
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
                    err instanceof Error ? err.message : "Could not read the document from storage."
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

/** Translate an adeu client error into a response the editor can act on. */
export function adeuErrorResponse(err: unknown): NextResponse {
    const name = (err as { name?: string } | null)?.name;

    if (name === "AdeuConfigError") {
        return fail(
            503,
            "service_not_configured",
            "The document editing service is not configured. Set ADEU_SERVICE_URL and " +
                "ADEU_SERVICE_API_KEY, and make sure the service is running."
        );
    }

    if (name === "AdeuServiceError") {
        const e = err as { statusCode: number; detail: string };
        // 4xx from the service is the caller's problem and is worth showing
        // verbatim; anything else is an outage.
        const status = e.statusCode >= 400 && e.statusCode < 500 ? e.statusCode : 502;
        return fail(status, "editing_failed", e.detail);
    }

    return fail(500, "internal_error", err instanceof Error ? err.message : "Unknown error");
}
