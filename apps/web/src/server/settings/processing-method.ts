/**
 * The processing method a new document gets when whoever added it named
 * none — `documents.defaultProcessingMethod`, resolved for the folder it
 * lands in (nearest folder override, else the workspace, else the registry
 * default "auto").
 *
 * Resolved server-side at the one choke point every ingestion path shares
 * (the document-creation lifecycle, see ../services/document-creation.ts),
 * so uploads, Drive and Gmail imports, and new versions all honour it without
 * each sending a choice. A person's explicit pick always wins.
 */

import { and, eq, inArray, or } from "drizzle-orm";

import type { OCRProvider } from "@launchstack/conversion/ocr/types";

import { db } from "~/server/db";
import { settingsValues } from "~/server/db/schema";
import { folderAncestors, normalizeFolderPath, UNFILED_FOLDER } from "~/lib/folders/path";
import { getSetting } from "~/lib/settings/registry";
import type { Executor } from "~/server/workspace/db-types";

import { resolveSetting } from "./resolve";

export const PROCESSING_METHOD_KEY = "documents.defaultProcessingMethod";

export type ProcessingMethod = "standard" | "auto" | "azure" | "landing_ai" | "datalab" | "docling";

/**
 * The provider pin a method stands for. "auto" pins nothing: the converter's
 * order decides (operator pin, Azure, Docling, Landing AI, Datalab, then the
 * text layer). "standard" is the text-only method — the PDF's own text layer,
 * no OCR.
 */
export function providerForMethod(method: ProcessingMethod): OCRProvider | undefined {
    switch (method) {
        case "auto":
            return undefined;
        case "standard":
            return "NATIVE_PDF";
        case "azure":
            return "AZURE";
        case "landing_ai":
            return "LANDING_AI";
        case "datalab":
            return "DATALAB";
        case "docling":
            return "DOCLING";
    }
}

/**
 * Only the PDF pipeline reads a provider pin (images always take the
 * automatic order; text, Office and web sources never OCR), so nothing else
 * pays for the settings read.
 */
export function honorsProcessingMethod(
    mimeType: string | null | undefined,
    filename: string | null | undefined
): boolean {
    if (mimeType?.toLowerCase() === "application/pdf") return true;
    return Boolean(filename?.toLowerCase().endsWith(".pdf"));
}

/** The effective method for a document landing in `folderPath` of this workspace. */
export async function resolveProcessingMethod(
    companyId: bigint,
    folderPath: string | null | undefined,
    executor: Executor = db
): Promise<ProcessingMethod> {
    const definition = getSetting(PROCESSING_METHOD_KEY);
    if (!definition) return "auto";

    const folder = folderPath ? normalizeFolderPath(folderPath) : null;
    const inFolder = folder && folder !== UNFILED_FOLDER ? folder : null;
    const folderIds = inFolder ? [inFolder, ...folderAncestors(inFolder)] : [];

    const rows = await executor
        .select({
            scopeType: settingsValues.scopeType,
            scopeId: settingsValues.scopeId,
            key: settingsValues.key,
            value: settingsValues.value,
            updatedBy: settingsValues.updatedBy,
            updatedAt: settingsValues.updatedAt,
        })
        .from(settingsValues)
        .where(
            and(
                eq(settingsValues.companyId, companyId),
                eq(settingsValues.key, PROCESSING_METHOD_KEY),
                or(
                    eq(settingsValues.scopeType, "workspace"),
                    ...(folderIds.length > 0
                        ? [
                              and(
                                  eq(settingsValues.scopeType, "folder"),
                                  inArray(settingsValues.scopeId, folderIds)
                              ),
                          ]
                        : [])
                )
            )
        );

    // No viewer: this acts for the workspace. The setting has no member
    // scope, so the empty id never matches a personal row.
    const resolved = resolveSetting(definition, rows, {
        authUserId: "",
        folderPath: inFolder,
        can: () => false,
    });
    return resolved.value as ProcessingMethod;
}

/**
 * The provider pin for a new document that came with no explicit choice, or
 * undefined for "auto" and for files the pin does not apply to. A failed
 * settings read never blocks an upload: it falls back to automatic.
 */
export async function defaultProviderFor(params: {
    companyId: bigint;
    category: string | null | undefined;
    mimeType: string | null | undefined;
    filename: string | null | undefined;
}): Promise<OCRProvider | undefined> {
    if (!honorsProcessingMethod(params.mimeType, params.filename)) return undefined;
    try {
        return providerForMethod(await resolveProcessingMethod(params.companyId, params.category));
    } catch (error) {
        console.warn(
            "[processing-method] Could not read the workspace default; using automatic:",
            error instanceof Error ? error.message : error
        );
        return undefined;
    }
}
