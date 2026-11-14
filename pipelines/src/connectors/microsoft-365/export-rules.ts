/**
 * What to do with each drive item: download it, recurse into it, follow it
 * to the drive it really lives in, or skip it with a reason. The Drive rules'
 * sibling, minus exports — Office files already are the bytes ingestion
 * wants, so nothing is converted on Microsoft's side. A type is downloaded
 * exactly when Drive would download it: when an ingestion adapter exists for
 * it (MIME_TO_SOURCE_TYPE in @launchstack/conversion/types).
 */

import { MIME_TO_SOURCE_TYPE } from "@launchstack/conversion/types";

import type { GraphDriveItem } from "./client";

export const ONENOTE_PACKAGE_TYPE = "oneNote";

export type Microsoft365Action =
    | {
          readonly action: "download";
          /** What ingestion receives — Graph's MIME, or the extension's when Graph had none. */
          readonly mimeType: string;
      }
    | { readonly action: "recurse" }
    | { readonly action: "resolve-remote" }
    | { readonly action: "skip"; readonly reason: string };

/**
 * Graph reports `application/octet-stream` (or nothing) for plain-text
 * formats it has no opinion on, most often Markdown. The filename settles
 * those; anything else unknown stays skipped.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const GENERIC_MIMES = new Set(["", "application/octet-stream", "binary/octet-stream"]);

function extensionOf(name: string): string {
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

export function resolveMicrosoft365Action(
    item: Pick<GraphDriveItem, "name" | "file" | "folder" | "package" | "remoteItem" | "deleted">
): Microsoft365Action {
    if (item.deleted) return { action: "skip", reason: "deleted" };
    if (item.remoteItem) return { action: "resolve-remote" };

    if (item.package) {
        return item.package.type === ONENOTE_PACKAGE_TYPE
            ? { action: "skip", reason: "OneNote notebook" }
            : { action: "skip", reason: `unsupported package ${item.package.type ?? "unknown"}` };
    }
    if (item.folder) return { action: "recurse" };
    if (!item.file) return { action: "skip", reason: "not a file" };

    const mime = (item.file.mimeType ?? "").toLowerCase();
    if (MIME_TO_SOURCE_TYPE[mime]) return { action: "download", mimeType: mime };
    if (GENERIC_MIMES.has(mime)) {
        const byName = MIME_BY_EXTENSION[extensionOf(item.name)];
        if (byName) return { action: "download", mimeType: byName };
    }
    return { action: "skip", reason: `unsupported type ${mime || "unknown"}` };
}
