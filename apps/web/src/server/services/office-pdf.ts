/**
 * Office document → PDF, through the Gotenberg service (ADR-009).
 *
 * Two routes render the same way and differ only in what they do with the
 * bytes: `/api/documents/pdf` hands them over as a download, and
 * `/api/documents/[id]/preview` shows them inline and keeps them per version.
 * The lookup, the format gate, the storage read and the error mapping live
 * here so the two cannot drift.
 */

import { and, eq } from "drizzle-orm";

import {
    OFFICE_CONVERTIBLE_EXTENSIONS,
    RenderingConfigError,
    RenderingServiceError,
} from "@launchstack/document-conversion-engine";
import { document } from "@launchstack/store/schema";
import type { DocumentScope } from "~/lib/authz/scope-types";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import { fetchFile } from "~/lib/storage";
import { translatorFor } from "~/i18n/translate";
import type { Locale } from "~/i18n/locales";
import { db } from "~/server/db";
import { getGotenbergClient } from "~/server/rendering";

/** Office MIME types uploads store in `file_type`, by the extension each implies. */
const OFFICE_MIME_EXTENSIONS: Readonly<Record<string, string>> = {
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-powerpoint": "ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "application/vnd.oasis.opendocument.text": "odt",
    "application/vnd.oasis.opendocument.spreadsheet": "ods",
    "application/vnd.oasis.opendocument.presentation": "odp",
    "application/rtf": "rtf",
    "application/pdf": "pdf",
};

/**
 * The extension Gotenberg's import filter will be picked from. `file_type`
 * holds a bare extension on older rows and a MIME type on uploads; a MIME
 * type read as an extension refused every uploaded Word file with a 415.
 */
export function documentExtension(fileType: string | null, title: string): string {
    const fromType = (fileType ?? "").toLowerCase().replace(/^\./, "");
    if (fromType && !fromType.includes("/")) return fromType;
    const dot = title.lastIndexOf(".");
    if (dot !== -1) return title.slice(dot + 1).toLowerCase();
    return OFFICE_MIME_EXTENSIONS[fromType] ?? "";
}

export interface OfficeDocumentRow {
    id: number;
    title: string;
    url: string;
    fileType: string | null;
    /** The version the bytes at `url` belong to; null on never-versioned rows. */
    currentVersionId: bigint | null;
}

/**
 * The document, if it exists and the caller may see it. Scoping is in the
 * SQL: a document in another company or in a folder outside the caller's
 * scope reads as missing, so the route's 404 cannot leak which ids are real.
 */
export async function findOfficeDocument(
    documentId: number,
    companyId: bigint,
    scope: DocumentScope
): Promise<OfficeDocumentRow | null> {
    const [row] = await db
        .select({
            id: document.id,
            title: document.title,
            url: document.url,
            fileType: document.fileType,
            currentVersionId: document.currentVersionId,
        })
        .from(document)
        .where(and(eq(document.id, documentId), scopedDocumentWhere(companyId, scope)));
    return row ?? null;
}

export interface OfficePdfFailure {
    ok: false;
    status: number;
    error: string;
    message: string;
}

export interface OfficePdfSuccess {
    ok: true;
    pdf: Buffer;
    /** The name the source file goes by, with its extension. */
    sourceName: string;
    /** `sourceName` with the extension swapped for `.pdf`. */
    pdfName: string;
}

export type OfficePdfResult = OfficePdfSuccess | OfficePdfFailure;

/**
 * Says no to a document the LibreOffice route is not asked to handle, before
 * anything is fetched or rendered. `null` means the format is fine.
 */
export function officeFormatRefusal(
    row: Pick<OfficeDocumentRow, "title" | "fileType">,
    locale: Locale
): OfficePdfFailure | null {
    const extension = documentExtension(row.fileType, row.title);
    if (OFFICE_CONVERTIBLE_EXTENSIONS.has(extension)) return null;
    const t = translatorFor(locale, "viewers.server.errors");
    return {
        ok: false,
        status: 415,
        error: "unsupported_type",
        message: extension === "pdf" ? t("alreadyPdf") : t("pdfOfficeOnly"),
    };
}

/** Reads the stored file and renders it to PDF. The format gate runs first. */
export async function renderOfficeDocumentPdf(
    row: Pick<OfficeDocumentRow, "title" | "url" | "fileType">,
    locale: Locale
): Promise<OfficePdfResult> {
    const refusal = officeFormatRefusal(row, locale);
    if (refusal) return refusal;

    const t = translatorFor(locale, "viewers.server.errors");
    const sources = translatorFor(locale, "sources.server.errors");
    const errors = translatorFor(locale, "errors.api");

    const gotenberg = getGotenbergClient();
    if (!gotenberg) {
        return {
            ok: false,
            status: 503,
            error: "service_not_configured",
            message: t("pdfNotConfigured"),
        };
    }

    let bytes: Buffer;
    try {
        const res = await fetchFile(row.url);
        if (!res.ok) {
            return {
                ok: false,
                status: 502,
                error: "fetch_failed",
                message: sources("storageReadHttp", { status: String(res.status) }),
            };
        }
        bytes = Buffer.from(await res.arrayBuffer());
    } catch (err) {
        return {
            ok: false,
            status: 502,
            error: "fetch_failed",
            message: err instanceof Error ? err.message : sources("storageRead"),
        };
    }

    const extension = documentExtension(row.fileType, row.title);
    const sourceName = row.title.toLowerCase().endsWith(`.${extension}`)
        ? row.title
        : `${row.title}.${extension}`;
    const pdfName = sourceName.replace(new RegExp(`\\.${extension}$`, "i"), ".pdf");

    try {
        const { pdf } = await gotenberg.officeToPdf({ file: bytes, filename: sourceName });
        return { ok: true, pdf, sourceName, pdfName };
    } catch (err) {
        if (err instanceof RenderingConfigError) {
            return { ok: false, status: 415, error: "unsupported_type", message: err.message };
        }
        if (err instanceof RenderingServiceError) {
            // 4xx from the service is this document's problem and worth
            // relaying; anything else is an outage.
            const status = err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 502;
            const trace = err.trace ? ` (trace ${err.trace})` : "";
            return {
                ok: false,
                status,
                error: "rendering_failed",
                message: `${err.detail}${trace}`,
            };
        }
        return {
            ok: false,
            status: 500,
            error: "internal_error",
            message: err instanceof Error ? err.message : errors("unknownError"),
        };
    }
}

/** A filename safe inside a quoted `Content-Disposition` parameter. */
export function dispositionFilename(name: string): string {
    return name.replace(/["\\\r\n]/g, "_");
}
