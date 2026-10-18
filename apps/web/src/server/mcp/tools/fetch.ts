/**
 * `fetch` — one readable document's current text, by the id `search` or
 * `list_sources` returned. ChatGPT's company-knowledge contract again:
 * `{id,title,text,url,metadata}` as the text content.
 *
 * The text is the current version's context chunks, in reading order, as
 * plain text (`readSourceText` in server/workspace-sources.ts, which Ask's
 * `read_source` shares). A missing id and an unreadable one get the same
 * answer.
 */
import { z } from "zod";

import { SOURCE_TEXT_MAX_CHARS, readSourceText } from "~/server/workspace-sources";

import { defineTool } from "../protocol";
import {
    READ_ONLY_ANNOTATIONS,
    READ_REQUIREMENT,
    documentNotFound,
    documentUrl,
    parseDocumentId,
} from "./shared";

export { joinChunkText } from "~/server/workspace-sources";

/** About fifty pages of dense text; longer documents are cut and say so. */
export const FETCH_MAX_CHARS = SOURCE_TEXT_MAX_CHARS;

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

        const source = await readSourceText(principal.ctx, documentId);
        if (!source) return { ok: false, message: documentNotFound(id) };

        const fetched: FetchedDocument = {
            id: String(source.id),
            title: source.title,
            text: source.text,
            url: documentUrl(origin, source.id),
            metadata: {
                folder: source.folder,
                createdAt: source.createdAt.toISOString(),
                updatedAt: source.updatedAt.toISOString(),
                truncated: source.truncated,
                characters: source.characters,
                indexed: source.indexed,
            },
        };
        if (source.mimeType) fetched.metadata.mimeType = source.mimeType;
        const structured = fetched as unknown as Record<string, unknown>;
        return { ok: true, text: JSON.stringify(fetched), structured };
    },
});
