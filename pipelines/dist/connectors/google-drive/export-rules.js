/**
 * What to do with each Drive MIME type: download it, export it (Google-native
 * files have no bytes of their own), recurse into it, or skip it with a
 * reason. Export targets are chosen to land on ingestion adapters that
 * already exist — see MIME_TO_SOURCE_TYPE in @launchstack/conversion/types.
 */
import { MIME_TO_SOURCE_TYPE } from "@launchstack/conversion/types";
export const GOOGLE_FOLDER_MIME = "application/vnd.google-apps.folder";
export const GOOGLE_SHORTCUT_MIME = "application/vnd.google-apps.shortcut";
/**
 * Docs export as Markdown (native export target, first-class ingestion
 * adapter, and far below the ~10 MB export cap where DOCX-with-images would
 * not be). Sheets/Slides keep their Office shapes to preserve multi-sheet and
 * slide structure for the existing adapters.
 */
const GOOGLE_NATIVE_EXPORTS = {
    "application/vnd.google-apps.document": { exportMime: "text/markdown", extension: ".md" },
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
export function resolveDriveAction(file) {
    const mime = file.mimeType;
    if (mime === GOOGLE_FOLDER_MIME)
        return { action: "recurse" };
    if (mime === GOOGLE_SHORTCUT_MIME)
        return { action: "resolve-shortcut" };
    const nativeExport = GOOGLE_NATIVE_EXPORTS[mime];
    if (nativeExport)
        return { action: "export", ...nativeExport };
    if (mime.startsWith("application/vnd.google-apps.")) {
        return { action: "skip", reason: `no export target for ${mime}` };
    }
    if (MIME_TO_SOURCE_TYPE[mime])
        return { action: "download" };
    return { action: "skip", reason: `unsupported type ${mime}` };
}
//# sourceMappingURL=export-rules.js.map