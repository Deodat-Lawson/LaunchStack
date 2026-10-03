/**
 * `search` — the person's readable documents, ranked for a query, one result
 * per document. The result shape is ChatGPT's company-knowledge contract
 * (`{"results":[{id,title,url,text}]}` as the text content), which Claude and
 * Gemini read just as well.
 */
import { z } from "zod";

import { defineTool } from "../protocol";
import { SNIPPET_SEPARATOR, searchWorkspace } from "../workspace-search";
import {
    READ_ONLY_ANNOTATIONS,
    READ_REQUIREMENT,
    countArgument,
    documentUrl,
    folderArgument,
} from "./shared";

export interface SearchResultItem {
    id: string;
    title: string;
    url: string;
    text: string;
    page?: number;
    folder?: string;
}

const args = z.object({
    query: z.string().trim().min(1, "must not be empty").max(1000),
    limit: countArgument(1, 20, 8),
    folder: folderArgument,
});

export const searchTool = defineTool({
    name: "search",
    title: "Search LaunchStack",
    description:
        "Search the documents in the person's LaunchStack workspace (only the ones they are allowed to open) and get the best-matching documents, one result per document. " +
        "Use it whenever the answer may be in the company's own material: plans, specs, customers, decisions, numbers, meeting notes, saved conversations. " +
        'Returns {"results":[{"id","title","url","text","page"?,"folder"?}]}, best match first, where text is a snippet of the matching passages; an empty list means nothing matched. ' +
        "Call fetch with a result's id to read the whole document, and cite the url when you use what it says.",
    inputSchema: {
        type: "object",
        properties: {
            query: {
                type: "string",
                minLength: 1,
                maxLength: 1000,
                description:
                    "What to look for, in natural language or keywords, e.g. 'Q4 pricing decision'.",
            },
            limit: {
                type: "integer",
                minimum: 1,
                maximum: 20,
                default: 8,
                description: "How many documents to return (1-20, default 8).",
            },
            folder: {
                type: "string",
                maxLength: 256,
                description:
                    "Only search this folder and its subfolders, as a path like 'Finance/Q3' (from list_sources).",
            },
        },
        required: ["query"],
        additionalProperties: false,
    },
    outputSchema: {
        type: "object",
        properties: {
            results: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        id: { type: "string", description: "Document id; pass it to fetch." },
                        title: { type: "string" },
                        url: { type: "string", description: "Link that opens the document." },
                        text: { type: "string", description: "Snippet of the matching passages." },
                        page: { type: "integer", description: "Page of the best passage." },
                        folder: { type: "string" },
                    },
                    required: ["id", "title", "url", "text"],
                },
            },
        },
        required: ["results"],
    },
    annotations: READ_ONLY_ANNOTATIONS,
    requires: READ_REQUIREMENT,
    args,
    async run({ query, limit, folder }, { principal, origin }) {
        const hits = await searchWorkspace(principal.ctx, { query, limit, folder });
        const results: SearchResultItem[] = hits.map(hit => {
            const item: SearchResultItem = {
                id: String(hit.documentId),
                title: hit.title,
                url: documentUrl(origin, hit.documentId),
                text: hit.snippets.join(SNIPPET_SEPARATOR),
            };
            if (hit.page !== undefined) item.page = hit.page;
            if (hit.folder) item.folder = hit.folder;
            return item;
        });
        const structured = { results };
        return { ok: true, text: JSON.stringify(structured), structured };
    },
});
