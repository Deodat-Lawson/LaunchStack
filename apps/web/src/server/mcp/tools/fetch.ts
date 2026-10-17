/**
 * `fetch` — one readable document's current text, by the id `search` or
 * `list_sources` returned. ChatGPT's company-knowledge contract again:
 * `{id,title,text,url,metadata}` as the text content.
 *
 * The text is the current version's context chunks, in reading order, as
 * plain text (the same rows the in-app text view renders as HTML). A missing
 * id and an unreadable one get the same answer.
 */
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { document, documentContextChunks } from "@launchstack/store/schema";

import { scopedDocumentWhere } from "~/lib/authz/scope";
import { db } from "~/server/db";

import { defineTool } from "../protocol";
import {
    READ_ONLY_ANNOTATIONS,
    READ_REQUIREMENT,
    documentNotFound,
    documentUrl,
    parseDocumentId,
} from "./shared";

/** About fifty pages of dense text; longer documents are cut and say so. */
export const FETCH_MAX_CHARS = 200_000;

const CHUNK_SEPARATOR = "\n\n";

const args = z.object({
    id: z
        .union([z.string(), z.number()])
        .transform(value => String(value).trim())
        .pipe(z.string().min(1, "must not be empty").max(64)),
});

export interface FetchedDocument {
    id: string;
    title: string;
    text: string;
    url: string;
    metadata: {
        folder: string;
        createdAt: string;
        updatedAt: string;
        truncated: boolean;
        /** Length of the full text, before any cut. */
        characters: number;
        /** False while the document has no extracted text (still processing, or none). */
        indexed: boolean;
        mimeType?: string;
    };
}

/** Joins chunks in order, stopping at `max` characters. */
export function joinChunkText(
    chunks: readonly string[],
    max = FETCH_MAX_CHARS
): { text: string; characters: number; truncated: boolean } {
    const parts = chunks.map(chunk => chunk.trim()).filter(chunk => chunk.length > 0);
    const full = parts.join(CHUNK_SEPARATOR);
    if (full.length <= max) return { text: full, characters: full.length, truncated: false };
    return { text: full.slice(0, max), characters: full.length, truncated: true };
}

export const fetchTool = defineTool({
    name: "fetch",
    title: "Read a LaunchStack document",
    description:
        "Read the full text of one document in the person's LaunchStack workspace, by the id that search or list_sources returned. " +
        "Use it when a search snippet is not enough to answer. " +
        'Returns {"id","title","text","url","metadata":{"folder","createdAt","updatedAt","truncated","characters","indexed"}}: ' +
        `text is the current version as plain text, cut at ${FETCH_MAX_CHARS.toLocaleString("en-US")} characters (metadata.truncated says when). Cite the url when you use it.`,
    inputSchema: {
        type: "object",
        properties: {
            id: {
                type: "string",
                minLength: 1,
                maxLength: 64,
                description: "The document id from a search or list_sources result.",
            },
        },
        required: ["id"],
        additionalProperties: false,
    },
    outputSchema: {
        type: "object",
        properties: {
            id: { type: "string" },
            title: { type: "string" },
            text: { type: "string" },
            url: { type: "string" },
            metadata: {
                type: "object",
                properties: {
                    folder: { type: "string" },
                    createdAt: { type: "string" },
                    updatedAt: { type: "string" },
                    truncated: { type: "boolean" },
                    characters: { type: "integer" },
                    indexed: { type: "boolean" },
                    mimeType: { type: "string" },
                },
                required: [
                    "folder",
                    "createdAt",
                    "updatedAt",
                    "truncated",
                    "characters",
                    "indexed",
                ],
            },
        },
        required: ["id", "title", "text", "url", "metadata"],
    },
    annotations: READ_ONLY_ANNOTATIONS,
    requires: READ_REQUIREMENT,
    args,
    async run({ id }, { principal, origin }) {
        const documentId = parseDocumentId(id);
        if (documentId === null) return { ok: false, message: documentNotFound(id) };

        const { ctx } = principal;
        const [row] = await db
            .select({
                id: document.id,
                title: document.title,
                category: document.category,
                currentVersionId: document.currentVersionId,
                mimeType: document.mimeType,
                createdAt: document.createdAt,
                updatedAt: document.updatedAt,
            })
            .from(document)
            .where(
                and(
                    eq(document.id, documentId),
                    scopedDocumentWhere(ctx.companyId, await ctx.documentScope())
                )
            )
            .limit(1);
        if (!row) return { ok: false, message: documentNotFound(id) };

        // A document without a current version has no current text; never fall
        // back to an older version's chunks.
        const chunks =
            row.currentVersionId === null
                ? []
                : await db
                      .select({ content: documentContextChunks.content })
                      .from(documentContextChunks)
                      .where(
                          and(
                              eq(documentContextChunks.documentId, BigInt(documentId)),
                              eq(documentContextChunks.versionId, row.currentVersionId)
                          )
                      )
                      .orderBy(
                          asc(documentContextChunks.pageNumber),
                          asc(documentContextChunks.id)
                      );

        const { text, characters, truncated } = joinChunkText(chunks.map(c => c.content));
        const fetched: FetchedDocument = {
            id: String(row.id),
            title: row.title,
            text,
            url: documentUrl(origin, Number(row.id)),
            metadata: {
                folder: row.category,
                createdAt: row.createdAt.toISOString(),
                updatedAt: (row.updatedAt ?? row.createdAt).toISOString(),
                truncated,
                characters,
                indexed: chunks.length > 0,
            },
        };
        if (row.mimeType) fetched.metadata.mimeType = row.mimeType;
        const structured = fetched as unknown as Record<string, unknown>;
        return { ok: true, text: JSON.stringify(fetched), structured };
    },
});
