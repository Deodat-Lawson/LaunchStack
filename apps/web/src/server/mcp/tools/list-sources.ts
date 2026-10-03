/**
 * `list_sources` — what a person can open in the workspace: the folders that
 * hold readable documents (with how many each holds directly) and the
 * readable documents themselves, newest first, a page at a time. The query
 * is `listReadableSources` (server/workspace-sources.ts), which Ask's
 * source tools share.
 *
 * Counts come from the readable documents, never from the folder table: a
 * visible folder can hold a restricted document, and its count must not
 * reveal one. Empty folders are therefore not listed.
 */
import { z } from "zod";

import { decodeListCursor, listReadableSources, originLabel } from "~/server/workspace-sources";

import { defineTool } from "../protocol";
import {
    READ_ONLY_ANNOTATIONS,
    READ_REQUIREMENT,
    countArgument,
    documentUrl,
    folderArgument,
} from "./shared";

export { decodeListCursor, encodeListCursor } from "~/server/workspace-sources";

const args = z.object({
    folder: folderArgument,
    limit: countArgument(1, 100, 50),
    cursor: z.string().trim().min(1).max(512).optional(),
});

export const listSourcesTool = defineTool({
    name: "list_sources",
    title: "List LaunchStack sources",
    description:
        "List what is in the person's LaunchStack workspace: the folders they can open, each with how many documents it holds, and their documents newest first (id, title, folder, url, updatedAt, and from: the app it was imported from, such as Google Drive). " +
        "Use it when the person asks what is in the workspace or a folder, or to find a document by browsing; use search to answer questions about content. " +
        "Pass folder to list one folder and its subfolders. When nextCursor is present, pass it back as cursor for the next page.",
    inputSchema: {
        type: "object",
        properties: {
            folder: {
                type: "string",
                maxLength: 256,
                description: "Only this folder and its subfolders, as a path like 'Finance/Q3'.",
            },
            limit: {
                type: "integer",
                minimum: 1,
                maximum: 100,
                default: 50,
                description: "Documents per page (1-100, default 50).",
            },
            cursor: {
                type: "string",
                maxLength: 512,
                description: "The nextCursor from the previous page.",
            },
        },
        additionalProperties: false,
    },
    outputSchema: {
        type: "object",
        properties: {
            folders: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                        documentCount: { type: "integer" },
                    },
                    required: ["path", "documentCount"],
                },
            },
            documents: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        id: { type: "string" },
                        title: { type: "string" },
                        folder: { type: "string" },
                        url: { type: "string" },
                        updatedAt: { type: "string" },
                        from: {
                            type: "string",
                            description:
                                "The app it was imported from, e.g. Google Drive; absent when it was added in LaunchStack.",
                        },
                    },
                    required: ["id", "title", "folder", "url", "updatedAt"],
                },
            },
            nextCursor: { type: "string" },
        },
        required: ["folders", "documents"],
    },
    annotations: READ_ONLY_ANNOTATIONS,
    requires: READ_REQUIREMENT,
    args,
    async run({ folder, limit, cursor: rawCursor }, { principal, origin }) {
        const cursor = rawCursor === undefined ? null : decodeListCursor(rawCursor);
        if (rawCursor !== undefined && cursor === null) {
            return {
                ok: false,
                message:
                    "That cursor is not valid. Call list_sources again without a cursor to start from the newest documents.",
            };
        }

        const listing = await listReadableSources(principal.ctx, { folder, limit, cursor });
        const structured: Record<string, unknown> = {
            folders: listing.folders,
            documents: listing.documents.map(row => {
                const from = originLabel(row.from);
                return {
                    id: String(row.id),
                    title: row.title,
                    folder: row.folder,
                    url: documentUrl(origin, row.id),
                    updatedAt: row.updatedAt.toISOString(),
                    ...(from ? { from } : {}),
                };
            }),
        };
        if (listing.nextCursor) structured.nextCursor = listing.nextCursor;
        return { ok: true, text: JSON.stringify(structured), structured };
    },
});
