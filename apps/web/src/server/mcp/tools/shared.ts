/**
 * Pieces the MCP tools share: who may run the read tools, how a document is
 * named to an assistant (its id and its link), and the one "not found" answer
 * that never says whether a document exists.
 */
import { z } from "zod";

import { MCP_SCOPE_READ } from "../config";
import type { McpToolRequirement, McpToolSpec } from "../protocol";

export const READ_REQUIREMENT: McpToolRequirement = {
    scope: MCP_SCOPE_READ,
    permission: "documents.read",
};

export const READ_ONLY_ANNOTATIONS: McpToolSpec<unknown>["annotations"] = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
};

/**
 * The link that opens a document in the app. `?source=d<id>` is the
 * workspace's own deep link (the rail's "Copy link", citations from other
 * apps): it opens the document as a tab, for anyone who can read it.
 */
export function documentUrl(origin: string, documentId: number): string {
    return `${origin}/employer/documents?source=d${documentId}`;
}

/**
 * A document id as tools accept it: the decimal id `search` returns, or the
 * app's own `d<id>` form. Anything else names no document.
 */
export function parseDocumentId(raw: string): number | null {
    const match = /^d?(\d{1,15})$/i.exec(raw.trim());
    if (!match) return null;
    const id = Number(match[1]);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Said for an id that does not exist and for one the person cannot read,
 * word for word, so the answer never reveals which it was.
 */
export function documentNotFound(id: string): string {
    return `No document with id "${id}" was found among the documents you can open in this workspace. Use an id returned by search or list_sources.`;
}

/** A count argument a model may send as a number or a numeric string. */
export function countArgument(min: number, max: number, fallback: number) {
    return z.preprocess(
        value => (typeof value === "string" && /^\s*\d+\s*$/.test(value) ? Number(value) : value),
        z.number().int().min(min).max(max).default(fallback)
    );
}

/** An optional folder path argument. */
export const folderArgument = z.string().trim().min(1).max(256).optional();
