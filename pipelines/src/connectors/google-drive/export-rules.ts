/**
 * What to do with each Drive MIME type: download it, export it (Google-native
 * files have no bytes of their own), recurse into it, or skip it with a
 * reason. Export targets are chosen to land on ingestion adapters that
 * already exist — see MIME_TO_SOURCE_TYPE in @launchstack/conversion/types.
 */

import { MIME_TO_SOURCE_TYPE } from "@launchstack/conversion/types";

import type { DriveFile } from "./client";

export const GOOGLE_FOLDER_MIME = "application/vnd.google-apps.folder";
export const GOOGLE_SHORTCUT_MIME = "application/vnd.google-apps.shortcut";

/** A format to ask files.export for, and the extension the stored copy carries. */
export interface ExportTarget {
    readonly exportMime: string;
    readonly extension: string;
}

export type DriveAction =
    | { readonly action: "download" }
    | {
          readonly action: "export";
          /** MIME to request from files.export, and what ingestion receives. */
          readonly exportMime: string;
          /** Appended to the filename so the ingestion router picks the right adapter. */
          readonly extension: string;
          /** Asked for instead when Drive refuses `exportMime` as over its export cap. */
          readonly fallback?: ExportTarget;
      }
    | { readonly action: "recurse" }
    | { readonly action: "resolve-shortcut" }
    | { readonly action: "skip"; readonly reason: string };

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Docs export as Word, the shape a Doc made with Create → Google Doc or a
 * Drive-linked file is already stored in, so the preview shows the Doc's
 * pages — fonts, alignment, tables — instead of its text re-rendered as
 * Markdown. Drive caps an export at about 10 MB, which a Doc full of images
 * can pass as DOCX; that one falls back to Markdown, which carries the words
 * far below the cap. Sheets/Slides keep their Office shapes to preserve
 * multi-sheet and slide structure for the existing adapters.
 */
const GOOGLE_NATIVE_EXPORTS: Record<string, ExportTarget & { fallback?: ExportTarget }> = {
    "application/vnd.google-apps.document": {
        exportMime: DOCX_MIME,
        extension: ".docx",
        fallback: { exportMime: "text/markdown", extension: ".md" },
    },
    "application/vnd.google-apps.spreadsheet": {
        exportMime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        extension: ".xlsx",
    },
    "application/vnd.google-apps.presentation": {
        exportMime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        extension: ".pptx",
    },
    "application/vnd.google-apps.drawing": { exportMime: "image/png", extension: ".png" },
};

export function resolveDriveAction(file: Pick<DriveFile, "mimeType">): DriveAction {
    const mime = file.mimeType;
    if (mime === GOOGLE_FOLDER_MIME) return { action: "recurse" };
    if (mime === GOOGLE_SHORTCUT_MIME) return { action: "resolve-shortcut" };

    const nativeExport = GOOGLE_NATIVE_EXPORTS[mime];
    if (nativeExport) return { action: "export", ...nativeExport };

    if (mime.startsWith("application/vnd.google-apps.")) {
        return { action: "skip", reason: `no export target for ${mime}` };
    }
    if (MIME_TO_SOURCE_TYPE[mime]) return { action: "download" };
    return { action: "skip", reason: `unsupported type ${mime}` };
}
