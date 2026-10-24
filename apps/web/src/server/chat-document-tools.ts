/**
 * Ask's document tool: `create_document` — the model writes a document into
 * the workspace when the person asks for one, the way `search_sources` reads
 * the ones already there (chat-source-tools.ts).
 *
 * Asked to "write a business plan for this and put it in my private space",
 * the chat had only tools that read. It said it could not create a file,
 * pasted two thousand words into the chat and told the person to copy them
 * into a new doc themselves. With this tool the document is made where they
 * asked, and the answer says what it is, where it went and what it rests on.
 *
 * A created document is an upload like any other, through the one ingestion
 * path: stored as Markdown, `processDocumentUpload`, then `recordUpload` for
 * ADR-014's defaults. No folder (Unfiled) is the person's Private section —
 * only they can open it until they share it; a folder gives it that folder's
 * audience, and a new top-level folder starts private to them. It becomes
 * searchable and citable as it indexes.
 *
 * The route offers the tool only to someone who may add files
 * (`documents.upload`); a folder takes edit access to it, as an upload does.
 */

import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import type { ChatCreatedSource } from "~/lib/chat-turns";
import {
    UNFILED_FOLDER,
    isUnfiledFolder,
    normalizeFolderPath,
    validateFolderPath,
} from "~/lib/folders/path";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { uploadFile } from "~/lib/storage";
import { processDocumentUpload } from "~/server/services/document-upload";
import { canEditFolder } from "~/server/services/folder-access";
import { recordUpload } from "~/server/workspace/added-documents";

import type { ChatTool } from "./chat-tool-loop";

/** Documents one answer may create. */
const MAX_CREATES = 3;
const MAX_TITLE_CHARS = 200;
const MAX_CONTENT_CHARS = 200_000;

/** Marks a source the chat wrote, beside the upload's own metadata. */
export const CHAT_DOCUMENT_ORIGIN = "chat";

export interface WriteDocumentInput {
    title: string;
    markdown: string;
    /** A folder path, or Unfiled — the person's Private section. */
    folder: string;
    /** The request URL, for the processing callback's origin. */
    requestUrl: string;
}

/** Thrown when the person may not add to the folder named. */
export class DocumentWriteDenied extends Error {
    constructor(readonly folder: string) {
        super(`The person cannot add files to "${folder}".`);
        this.name = "DocumentWriteDenied";
    }
}

/** `"Scenario Simulator — Business Plan"` → `Scenario-Simulator-Business-Plan.md`. */
export function documentFilename(title: string): string {
    const base =
        title
            .replace(/[^a-zA-Z0-9\s\-_]/g, "")
            .trim()
            .replace(/\s+/g, "-")
            .slice(0, 100) || "document";
    return `${base}.md`;
}

/** Store the Markdown and add it as a source, with the defaults of a file a person added. */
export async function writeWorkspaceDocument(
    ctx: WorkspaceContext,
    input: WriteDocumentInput
): Promise<ChatCreatedSource> {
    const folder = isUnfiledFolder(input.folder) ? UNFILED_FOLDER : input.folder;
    if (!(await canEditFolder(ctx, folder))) throw new DocumentWriteDenied(folder);

    const filename = documentFilename(input.title);
    const stored = await uploadFile({
        filename,
        data: Buffer.from(input.markdown, "utf8"),
        contentType: "text/markdown",
        userId: ctx.authUserId,
        companyId: ctx.companyId,
    });
    const upload = await processDocumentUpload({
        user: { userId: ctx.authUserId, companyId: ctx.companyId },
        documentName: input.title,
        rawDocumentUrl: stored.url,
        requestUrl: input.requestUrl,
        category: folder === UNFILED_FOLDER ? undefined : folder,
        // Every call is its own document; the session dedupes repeats.
        creationKey: `chat-document:${ctx.userPk}:${randomUUID()}`,
        explicitStorageType: stored.provider,
        mimeType: "text/markdown",
        originalFilename: filename,
        ocrMetadata: { createdBy: CHAT_DOCUMENT_ORIGIN },
    });
    // Loose, it starts private to them; filed, it takes its folder's audience.
    await recordUpload(ctx, upload);
    return {
        documentId: upload.document.id,
        title: upload.document.title,
        folder: normalizeFolderPath(upload.document.category),
    };
}

export interface DocumentToolPorts {
    write?: (ctx: WorkspaceContext, input: WriteDocumentInput) => Promise<ChatCreatedSource>;
}

export interface DocumentToolSession {
    tools: ChatTool[];
    /** Every document the model created, in order. */
    created: ChatCreatedSource[];
}

const CreateArgs = z.object({
    title: z.string().trim().min(1, "must not be empty").max(MAX_TITLE_CHARS),
    content: z
        .string()
        .refine(value => value.trim().length > 0, "must not be empty")
        .refine(
            value => value.length <= MAX_CONTENT_CHARS,
            `must be at most ${MAX_CONTENT_CHARS.toLocaleString("en-US")} characters`
        ),
    folder: z.string().trim().max(256).optional(),
});

/** Arguments a model sends as `null` mean "not given". */
function withoutNulls(args: unknown): unknown {
    if (!args || typeof args !== "object" || Array.isArray(args)) return args;
    return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== null));
}

/**
 * The folder the model named, as a path. "Private" is the rail section an
 * unfiled document sits in — what people call their private space — not a
 * folder to create, so it means no folder, as Unfiled does.
 */
function folderFrom(raw: string | undefined): string {
    const path = normalizeFolderPath(raw);
    if (isUnfiledFolder(path) || /^private( space)?$/i.test(path)) return UNFILED_FOLDER;
    const problem = validateFolderPath(path);
    if (problem) throw new Error(`Invalid folder: ${problem}`);
    return path;
}

function where(source: ChatCreatedSource): string {
    return isUnfiledFolder(source.folder)
        ? "in the person's Private section: only they can open it until they share it"
        : `in the folder "${source.folder}", with that folder's sharing (a new top-level folder starts private to the person)`;
}

export function createDocumentTools(
    ctx: WorkspaceContext,
    options: { requestUrl: string },
    ports: DocumentToolPorts = {}
): DocumentToolSession {
    const write = ports.write ?? writeWorkspaceDocument;
    const created: ChatCreatedSource[] = [];
    /** A repeated call with the same document gets the first one back. */
    const byContent = new Map<string, ChatCreatedSource>();

    const createTool: ChatTool = {
        name: "create_document",
        description:
            "Create a document in this workspace from Markdown you write, as a source the person can open, edit, share, search and cite. " +
            "Call it when the person asks you to write, draft, create, make or save something as a document, doc, file, page or note, or to put it in their workspace, their private space or a folder — never on your own initiative. " +
            "Send the whole document in content, finished and in Markdown (headings, lists, tables), not a summary of it. " +
            "Leave folder out to put it in the person's Private section, which is their private space; pass a folder path from a listing only when they name a folder. " +
            `At most ${MAX_CREATES} documents per answer.`,
        parameters: {
            type: "object",
            properties: {
                title: {
                    type: "string",
                    description: "The document's title, e.g. Scenario Simulator — Business Plan.",
                },
                content: {
                    type: "string",
                    description: "The complete document, in Markdown.",
                },
                folder: {
                    type: "string",
                    description:
                        "Only when the person names a folder: its path, as a listing gives it. Leave out for their Private section.",
                },
            },
            required: ["title", "content"],
            additionalProperties: false,
        },
        describe: args => {
            const title = (args as { title?: unknown } | null)?.title;
            return typeof title === "string" && title.trim()
                ? `Writing “${title.trim().slice(0, 80)}”`
                : "Writing a document";
        },
        run: async args => {
            const parsed = CreateArgs.safeParse(withoutNulls(args));
            if (!parsed.success) {
                throw new Error(
                    `Invalid arguments: ${parsed.error.issues.map(issue => `${issue.path.join(".") || "input"} ${issue.message}`).join("; ")}`
                );
            }
            const { title, content } = parsed.data;
            const folder = folderFrom(parsed.data.folder);
            const key = createHash("sha256")
                .update(`${folder}\u0000${title}\u0000${content}`)
                .digest("hex");
            const earlier = byContent.get(key);
            if (earlier) {
                return `"${earlier.title}" (d${earlier.documentId}) was already created ${where(earlier)}. Do not create it again.`;
            }
            if (created.length >= MAX_CREATES) {
                throw new Error("The document budget for this answer is used up. Answer now.");
            }
            let source: ChatCreatedSource;
            try {
                source = await write(ctx, {
                    title,
                    markdown: content,
                    folder,
                    requestUrl: options.requestUrl,
                });
            } catch (error) {
                if (error instanceof DocumentWriteDenied) {
                    throw new Error(
                        `${error.message} Create it without a folder (their Private section), or ask them which folder to use.`
                    );
                }
                throw error;
            }
            created.push(source);
            byContent.set(key, source);
            return (
                `Created "${source.title}" (d${source.documentId}) ${where(source)}. ` +
                "The chat shows it under your answer with a button to open it, and it becomes searchable once it is indexed, in a minute or so."
            );
        },
    };

    return { tools: [createTool], created };
}

// --- what the model is told -------------------------------------------------

/** The system-prompt section that goes with `create_document`. */
export function documentToolsPrompt(): string {
    return [
        "## Writing documents",
        "You can create a document in this workspace with `create_document`. When the person asks you to write, draft, create or save a document, doc, file, plan, brief or note — or to put something in their private space or a folder — write it in full and create it; never say you cannot create files, and never ask them to copy and paste it into a document themselves. Their private space is their Private section: leave folder out to put it there.",
        "When the document is about their company, product, customers or numbers, look through their sources first and build on what they say. Name the sources you drew on inside the document, and mark any figure that comes from no source — a market size, a price, a projection — as an assumption to check, rather than stating it as fact.",
        "After you create it, answer in a few short lines: what you created and where, which sources it rests on (or that it rests on general knowledge because their sources do not cover it), and the two or three things most worth checking or adding. Do not repeat the document in the chat.",
        "If the person asks you to save something already in this conversation, create the document from that text as it stands.",
    ].join("\n");
}

/**
 * What the model is told when the person's role cannot add files: that the
 * workspace could hold the document, and why it cannot here.
 */
export function noDocumentToolsPrompt(): string {
    return "This person's role in the workspace cannot add documents, so you cannot create one for them. If they ask for a document, write it in the chat, and say that their role cannot add files here and a workspace admin can give them upload access — never that LaunchStack cannot create documents.";
}
