/**
 * `list_sources` — what a person can open in the workspace: the folders that
 * hold readable documents (with how many each holds directly) and the
 * readable documents themselves, newest first, a page at a time.
 *
 * Counts come from the readable documents, never from the folder table: a
 * visible folder can hold a restricted document, and its count must not
 * reveal one. Empty folders are therefore not listed.
 *
 * Paging is keyset, on (last change, id), so a document added between pages
 * neither repeats nor pushes another off a page. The cursor carries the sort
 * key as Postgres printed it, microseconds and all.
 */
import { and, asc, desc, sql } from "drizzle-orm";
import { z } from "zod";

import { document } from "@launchstack/store/schema";

import { scopedDocumentWhere } from "~/lib/authz/scope";
import { db } from "~/server/db";

import { defineTool } from "../protocol";
import { documentInFolder } from "../workspace-search";
import {
    READ_ONLY_ANNOTATIONS,
    READ_REQUIREMENT,
    countArgument,
    documentUrl,
    folderArgument,
} from "./shared";

interface ListCursor {
    /** `coalesce(updated_at, created_at)::text` of the last row on the page. */
    at: string;
    id: number;
}

const TIMESTAMP_TEXT =
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)?$/;

export function encodeListCursor(cursor: ListCursor): string {
    return Buffer.from(JSON.stringify({ at: cursor.at, id: cursor.id }), "utf8").toString(
        "base64url"
    );
}

export function decodeListCursor(raw: string): ListCursor | null {
    try {
        const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
        if (typeof value !== "object" || value === null) return null;
        const { at, id } = value as Record<string, unknown>;
        if (typeof at !== "string" || !TIMESTAMP_TEXT.test(at)) return null;
        if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return null;
        return { at, id };
    } catch {
        return null;
    }
}

const args = z.object({
    folder: folderArgument,
    limit: countArgument(1, 100, 50),
    cursor: z.string().trim().min(1).max(512).optional(),
});

export const listSourcesTool = defineTool({
    name: "list_sources",
    title: "List LaunchStack sources",
    description:
        "List what is in the person's LaunchStack workspace: the folders they can open, each with how many documents it holds, and their documents newest first (id, title, folder, url, updatedAt). " +
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

        const { ctx } = principal;
        const readable = and(
            scopedDocumentWhere(ctx.companyId, await ctx.documentScope()),
            folder ? documentInFolder(folder) : undefined
        );
        const changedAt = sql`coalesce(${document.updatedAt}, ${document.createdAt})`;

        const [folderRows, documentRows] = await Promise.all([
            db
                .select({ path: document.category, count: sql<number>`count(*)::int` })
                .from(document)
                .where(readable)
                .groupBy(document.category)
                .orderBy(asc(document.category)),
            db
                .select({
                    id: document.id,
                    title: document.title,
                    category: document.category,
                    createdAt: document.createdAt,
                    updatedAt: document.updatedAt,
                    sortKey: sql<string>`(${changedAt})::text`,
                })
                .from(document)
                .where(
                    and(
                        readable,
                        cursor
                            ? sql`(${changedAt}, ${document.id}) < (${cursor.at}::timestamptz, ${cursor.id})`
                            : undefined
                    )
                )
                .orderBy(desc(changedAt), desc(document.id))
                .limit(limit + 1),
        ]);

        const page = documentRows.slice(0, limit);
        const last = page[page.length - 1];
        const structured: Record<string, unknown> = {
            folders: folderRows.map(row => ({ path: row.path, documentCount: Number(row.count) })),
            documents: page.map(row => ({
                id: String(row.id),
                title: row.title,
                folder: row.category,
                url: documentUrl(origin, Number(row.id)),
                updatedAt: (row.updatedAt ?? row.createdAt).toISOString(),
            })),
        };
        if (documentRows.length > limit && last) {
            structured.nextCursor = encodeListCursor({ at: last.sortKey, id: Number(last.id) });
        }
        return { ok: true, text: JSON.stringify(structured), structured };
    },
});
