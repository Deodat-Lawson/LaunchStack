/**
 * `add_document` — an assistant files something the person gave it into the
 * workspace as a Source: a Claude artifact, a document it holds as text, a
 * file from start_upload, or a file attached in ChatGPT.
 *
 * The folder decides who can see it (ADR-014), so the tool never guesses
 * one. Without a folder it stores the content as a draft and asks:
 *
 * - a 2026-07-28 client that can show forms (Claude Code, ChatGPT) gets an
 *   `input_required` form — folder choices with their audience, the title —
 *   and retries the same call with the answers;
 * - any other client gets the same questions as a normal result for the
 *   model to ask, plus a `draftId` to call back with, so the content is
 *   never sent twice.
 *
 * A same-title document already in the chosen folder raises one more
 * question: a new version of it, or a separate document. A declined or
 * dismissed form files nothing but keeps the draft, so the model can still
 * ask in words: some clients decline every form they cannot show.
 */
import { z } from "zod";

import {
    AssistantDocumentError,
    fileStagedDocument,
    findSameTitle,
    listFolderChoices,
    resolveDestination,
    type FolderChoice,
    type SameTitleDocument,
} from "~/server/assistant-documents";
import type { McpStagedFile } from "~/server/db/schema";

import { MCP_SCOPE_WRITE } from "../config";
import {
    CONTENT_FORMATS,
    CONTENT_ORIGINS,
    SUPPORTED_FILE_EXTENSIONS,
    fileTypesFor,
    prepareTextContent,
    safeFilename,
    titleFromFilename,
} from "../document-content";
import {
    defineTool,
    type McpInputRequest,
    type McpToolContext,
    type McpToolOutcome,
} from "../protocol";
import { RemoteFileError, downloadAssistantFile } from "../remote-file";
import { argumentsDigest, signRequestState, verifyRequestState } from "../request-state";
import { StagingError, loadStagedFile, stageDraft, type StagingOwner } from "../staging";
import { parseDocumentId } from "./shared";

export const ADD_DOCUMENT_TOOL = "add_document";
export const ADD_DOCUMENT_RATE_LIMIT = { maxRequests: 60, windowMs: 15 * 60 * 1000 };
/** Characters of text content one call takes; the request body cap is 8 MB. */
export const MAX_CONTENT_CHARS = 6_000_000;

const STAGED_ID = /^(draft|upload)_[A-Za-z0-9_-]{10,40}$/;

const chatGptFile = z.object({
    download_url: z.string().trim().url().max(4096),
    file_id: z.string().trim().max(256).optional(),
    mime_type: z.string().trim().max(128).optional(),
    file_name: z.string().trim().max(256).optional(),
});

const args = z
    .object({
        title: z.string().trim().min(1).max(200).optional(),
        content: z.string().min(1).max(MAX_CONTENT_CHARS).optional(),
        format: z.enum(CONTENT_FORMATS).optional(),
        origin: z.enum(CONTENT_ORIGINS).optional(),
        sourceUrl: z.string().trim().url().max(2048).optional(),
        file: chatGptFile.optional(),
        uploadId: z
            .string()
            .trim()
            .regex(STAGED_ID, "must be an uploadId from start_upload")
            .optional(),
        draftId: z
            .string()
            .trim()
            .regex(STAGED_ID, "must be a draftId from add_document")
            .optional(),
        folder: z.string().trim().min(1).max(256).optional(),
        documentId: z
            .union([z.string(), z.number()])
            .transform(value => String(value))
            .optional(),
        addAsNew: z.boolean().optional(),
    })
    .superRefine((value, issue) => {
        const given = [value.content, value.file, value.uploadId, value.draftId].filter(
            entry => entry !== undefined
        ).length;
        if (given !== 1) {
            issue.addIssue({
                code: z.ZodIssueCode.custom,
                message: "send exactly one of content, file, uploadId or draftId",
            });
        }
        if (value.documentId !== undefined && parseDocumentId(value.documentId) === null) {
            issue.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["documentId"],
                message: "must be a document id from search, list_sources or an earlier result",
            });
        }
    });

type Args = z.infer<typeof args>;

/** What is remembered about a staged row between calls (`details` jsonb). */
export interface StagedDetails {
    suggestedTitle: string;
    ingestMimeType: string;
    artifactType: string | null;
    origin: string | null;
    sourceUrl: string | null;
}

function detailsOf(row: McpStagedFile): StagedDetails {
    const raw = (row.details ?? {}) as Partial<StagedDetails>;
    return {
        suggestedTitle: raw.suggestedTitle ?? titleFromFilename(row.filename),
        ingestMimeType: raw.ingestMimeType ?? row.mimeType,
        artifactType: raw.artifactType ?? null,
        origin: raw.origin ?? null,
        sourceUrl: raw.sourceUrl ?? null,
    };
}

/** What a form round trip carries in its signed state. */
interface ResumeState {
    stagedId: string;
    stage: "destination" | "duplicate";
    folder?: string;
    title?: string;
}

function resumeStateOf(data: Record<string, unknown>): ResumeState | null {
    if (typeof data.stagedId !== "string" || !STAGED_ID.test(data.stagedId)) return null;
    if (data.stage !== "destination" && data.stage !== "duplicate") return null;
    return {
        stagedId: data.stagedId,
        stage: data.stage,
        folder: typeof data.folder === "string" ? data.folder : undefined,
        title: typeof data.title === "string" ? data.title : undefined,
    };
}

/** An elicitation answer: `{ action, content }`. */
function elicitAnswer(
    value: unknown
): { action: "accept" | "decline" | "cancel"; content: Record<string, unknown> } | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (record.action !== "accept" && record.action !== "decline" && record.action !== "cancel") {
        return null;
    }
    const content =
        typeof record.content === "object" &&
        record.content !== null &&
        !Array.isArray(record.content)
            ? (record.content as Record<string, unknown>)
            : {};
    return { action: record.action, content };
}

function text(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function ownerOf(context: McpToolContext): StagingOwner {
    const { ctx } = context.principal;
    return { authUserId: ctx.authUserId, userPk: ctx.userPk, companyId: ctx.companyId };
}

function bindingOf(context: McpToolContext) {
    const { ctx } = context.principal;
    return {
        tool: ADD_DOCUMENT_TOOL,
        authUserId: ctx.authUserId,
        companyId: ctx.companyId,
        argumentsDigest: argumentsDigest(context.rawArguments),
    };
}

/** The argument name a staged row is called back with. */
function handleArg(row: McpStagedFile): "draftId" | "uploadId" {
    return row.kind === "upload" ? "uploadId" : "draftId";
}

function canAskWithForm(context: McpToolContext): boolean {
    return context.client.era === "modern" && context.client.formElicitation;
}

// ---------------------------------------------------------------------------
// Staging what the call carries
// ---------------------------------------------------------------------------

async function stageFromArguments(a: Args, owner: StagingOwner): Promise<McpStagedFile> {
    if (a.draftId) return loadStagedFile(owner, a.draftId);
    if (a.uploadId) return loadStagedFile(owner, a.uploadId);
    if (a.content !== undefined) {
        const prepared = prepareTextContent({
            content: a.content,
            format: a.format,
            origin: a.origin,
            title: a.title,
        });
        const details: StagedDetails = {
            suggestedTitle: prepared.suggestedTitle,
            ingestMimeType: prepared.ingestMimeType,
            artifactType: prepared.artifactType,
            origin: a.origin ?? null,
            sourceUrl: a.sourceUrl ?? null,
        };
        return stageDraft(owner, {
            data: prepared.data,
            filename: prepared.filename,
            mimeType: prepared.storageMimeType,
            details: { ...details },
        });
    }
    const file = a.file!;
    const name = file.file_name ?? "";
    const remote = await downloadAssistantFile(file.download_url);
    const types = fileTypesFor(name, file.mime_type ?? remote.contentType);
    if (!types) {
        throw new AssistantDocumentError(
            "invalid",
            `LaunchStack cannot read that kind of file${name ? ` ("${name}")` : ""}. Supported: ${SUPPORTED_FILE_EXTENSIONS.join(", ")}.`
        );
    }
    const filename = safeFilename(name || "attachment");
    const details: StagedDetails = {
        suggestedTitle: a.title ?? titleFromFilename(name || "Attachment"),
        ingestMimeType: types.ingestMimeType,
        artifactType: types.artifactType,
        origin: a.origin ?? "chatgpt",
        sourceUrl: a.sourceUrl ?? null,
    };
    return stageDraft(owner, {
        data: remote.data,
        filename,
        mimeType: types.storageMimeType,
        details: { ...details },
    });
}

// ---------------------------------------------------------------------------
// Asking
// ---------------------------------------------------------------------------

function folderLines(choices: FolderChoice[]): string {
    return choices.map(choice => `- ${choice.path} (${choice.whoCanSee})`).join("\n");
}

async function askDestination(
    context: McpToolContext,
    staged: McpStagedFile,
    title: string
): Promise<McpToolOutcome> {
    const choices = await listFolderChoices(context.principal.ctx);
    if (canAskWithForm(context)) {
        const request: McpInputRequest = {
            method: "elicitation/create",
            params: {
                mode: "form",
                message: `Where should "${title}" go in LaunchStack? Who can see it follows the folder.`,
                requestedSchema: {
                    type: "object",
                    properties: {
                        folder: {
                            type: "string",
                            title: "Folder",
                            description: "Who can see the document follows the folder.",
                            oneOf: choices.map(choice => ({
                                const: choice.path,
                                title: `${choice.path} (${choice.whoCanSee})`,
                            })),
                            default: choices[0]?.path,
                        },
                        newFolder: {
                            type: "string",
                            title: "Or a new folder",
                            description:
                                "Creates a folder only you can see. Leave empty to use the one above.",
                            maxLength: 256,
                        },
                        title: {
                            type: "string",
                            title: "Title",
                            default: title,
                            maxLength: 200,
                        },
                    },
                    required: ["folder"],
                },
            },
        };
        return {
            inputRequired: {
                inputRequests: { destination: request },
                requestState: signRequestState(bindingOf(context), {
                    stagedId: staged.id,
                    stage: "destination",
                }),
            },
        };
    }
    const arg = handleArg(staged);
    return {
        ok: true,
        text:
            `Nothing was added yet. Before filing "${title}", ask the person which folder it should go in; the folder decides who can see it:\n` +
            `${folderLines(choices)}\n` +
            `They can also name a new folder (only they will see it). Confirm the title "${title}" with them too.\n` +
            `Then call add_document again with ${arg} "${staged.id}", folder and title. Do not send the content again; this ${arg === "uploadId" ? "upload" : "draft"} is kept for an hour.`,
        structured: {
            status: "needs_input",
            question: "folder",
            [arg]: staged.id,
            suggestedTitle: title,
            folders: choices.map(choice => ({ path: choice.path, whoCanSee: choice.whoCanSee })),
            expiresAt: staged.expiresAt.toISOString(),
        },
    };
}

async function askDuplicate(
    context: McpToolContext,
    staged: McpStagedFile,
    title: string,
    folder: string,
    same: SameTitleDocument[]
): Promise<McpToolOutcome> {
    if (canAskWithForm(context)) {
        const request: McpInputRequest = {
            method: "elicitation/create",
            params: {
                mode: "form",
                message: `"${title}" is already in ${folder}. Add this as a new version of it, or as a separate document?`,
                requestedSchema: {
                    type: "object",
                    properties: {
                        choice: {
                            type: "string",
                            title: "Add as",
                            oneOf: [
                                ...same.map(doc => ({
                                    const: `version:${doc.id}`,
                                    title: `A new version of "${doc.title}"`,
                                })),
                                { const: "new", title: "A separate document" },
                            ],
                            default: `version:${same[0]!.id}`,
                        },
                    },
                    required: ["choice"],
                },
            },
        };
        return {
            inputRequired: {
                inputRequests: { duplicate: request },
                requestState: signRequestState(bindingOf(context), {
                    stagedId: staged.id,
                    stage: "duplicate",
                    folder,
                    title,
                }),
            },
        };
    }
    const arg = handleArg(staged);
    const list = same.map(doc => `"${doc.title}" (documentId ${doc.id})`).join(", ");
    return {
        ok: true,
        text:
            `Nothing was added yet. ${folder} already has ${list}. Ask the person whether this is a new version of it or a separate document.\n` +
            `New version: call add_document again with ${arg} "${staged.id}" and documentId ${same[0]!.id}. ` +
            `Separate document: call again with ${arg} "${staged.id}", folder "${folder}", title "${title}" and addAsNew: true.`,
        structured: {
            status: "needs_input",
            question: "duplicate",
            [arg]: staged.id,
            folder,
            suggestedTitle: title,
            sameTitle: same.map(doc => ({ documentId: doc.id, title: doc.title })),
            expiresAt: staged.expiresAt.toISOString(),
        },
    };
}

// ---------------------------------------------------------------------------
// The tool
// ---------------------------------------------------------------------------

function failure(error: unknown): McpToolOutcome | null {
    if (
        error instanceof AssistantDocumentError ||
        error instanceof StagingError ||
        error instanceof RemoteFileError
    ) {
        return { ok: false, message: `LaunchStack could not add it: ${error.message}` };
    }
    return null;
}

async function run(a: Args, context: McpToolContext): Promise<McpToolOutcome> {
    const { principal, origin } = context;
    const { ctx } = principal;
    const owner = ownerOf(context);

    // A form round trip (2026-07-28): the signed state says which staged row
    // and which question the answers are for.
    let resume: ResumeState | null = null;
    let answers: Record<string, unknown> = {};
    if (context.roundTrip) {
        const state = context.roundTrip.requestState;
        const check = state ? verifyRequestState(state, bindingOf(context)) : null;
        resume = check?.ok ? resumeStateOf(check.data) : null;
        if (!resume) {
            return {
                ok: false,
                message:
                    "LaunchStack could not accept those answers: the form expired or the call changed. Call add_document again without answers to start over.",
            };
        }
        const answer = elicitAnswer(context.roundTrip.inputResponses[resume.stage]);
        if (answer && answer.action !== "accept") {
            // Nothing is filed. The draft is kept (it expires within the hour):
            // some clients decline every form they cannot show (Codex in a
            // non-interactive run does), and that is not the person saying no.
            const arg = resume.stagedId.startsWith("upload_") ? "uploadId" : "draftId";
            const how = answer.action === "cancel" ? "dismissed" : "declined";
            return {
                ok: true,
                text:
                    `Nothing was added: the form was ${how}. Some assistants decline forms they cannot show. ` +
                    `If the person still wants it added, ask them in chat which folder it should go in, then call add_document again with ${arg} "${resume.stagedId}" and folder; do not send the content again. ` +
                    `If they do not, do nothing: it is deleted within the hour.`,
                structured: {
                    status: answer.action === "cancel" ? "cancelled" : "declined",
                    [arg]: resume.stagedId,
                },
            };
        }
        answers = answer?.content ?? {};
    }

    try {
        const staged = resume
            ? await loadStagedFile(owner, resume.stagedId)
            : await stageFromArguments(a, owner);
        const details = detailsOf(staged);

        const title = text(answers.title) ?? resume?.title ?? a.title ?? details.suggestedTitle;
        const folderAnswer = text(answers.newFolder) ?? text(answers.folder);
        const folderAsked = folderAnswer ?? resume?.folder ?? a.folder;
        const choice = text(answers.choice);

        let documentId: number | undefined =
            a.documentId !== undefined ? (parseDocumentId(a.documentId) ?? undefined) : undefined;
        if (choice?.startsWith("version:")) {
            documentId = parseDocumentId(choice.slice("version:".length)) ?? undefined;
        }

        let folder = "";
        let createdFolder = false;
        if (documentId === undefined) {
            if (folderAsked === undefined) return await askDestination(context, staged, title);
            const destination = await resolveDestination(ctx, folderAsked);
            folder = destination.path;
            createdFolder = destination.created;
            const decided = a.addAsNew === true || choice === "new";
            if (!decided) {
                const same = await findSameTitle(ctx, folder, title);
                if (same.length > 0)
                    return await askDuplicate(context, staged, title, folder, same);
            }
        }

        const artifactType =
            details.artifactType &&
            ["html", "svg", "markdown", "mermaid", "react", "code"].includes(details.artifactType)
                ? (details.artifactType as
                      | "html"
                      | "svg"
                      | "markdown"
                      | "mermaid"
                      | "react"
                      | "code")
                : null;
        const filed = await fileStagedDocument(ctx, origin, {
            staged,
            title,
            folder,
            ingestMimeType: details.ingestMimeType,
            artifact: artifactType ? { type: artifactType, sourceUrl: details.sourceUrl } : null,
            fromLabel: principal.label,
            documentId,
            metadata: {
                addedFrom: {
                    assistant: principal.family,
                    clientName: principal.label,
                    origin: details.origin,
                },
            },
        });

        const where =
            filed.status === "version_added"
                ? `Added a new version of "${filed.title}" (document ${filed.documentId}) in ${filed.folder}`
                : `Added "${filed.title}" to ${filed.folder}${createdFolder ? " (a new folder)" : ""}`;
        return {
            ok: true,
            text:
                `${where} in LaunchStack. Who can see it: ${filed.whoCanSee}. ` +
                `Link: ${filed.url}. LaunchStack is processing it; it becomes searchable within a minute or two.`,
            structured: {
                status: filed.status,
                documentId: filed.documentId,
                title: filed.title,
                folder: filed.folder,
                whoCanSee: filed.whoCanSee,
                url: filed.url,
                ...(createdFolder ? { createdFolder: true } : {}),
            },
        };
    } catch (error) {
        const outcome = failure(error);
        if (outcome) return outcome;
        throw error;
    }
}

export const addDocumentTool = defineTool({
    name: ADD_DOCUMENT_TOOL,
    title: "Add a document to LaunchStack",
    description:
        "Add something to the person's LaunchStack workspace: a Claude artifact, a document or text you wrote or were given, a file they attached, or a file uploaded with start_upload. " +
        "Use it only when the person asks to add, save, upload or put something into LaunchStack. " +
        "Send content exactly as it is (an artifact's full source, a document's full text); never summarise it. " +
        "The folder decides who can see the document, so leave folder out unless the person named one: LaunchStack then keeps the content as a draft and either shows the person a form or answers with the folders to offer and a draftId. " +
        "Ask the person, then call again with draftId and folder; do not send the content again. " +
        "If a document with the same title is already in that folder you will be asked whether this is a new version (pass documentId) or a separate document (pass addAsNew: true). " +
        "For a PDF, Word file, slides, spreadsheet or image on the person's computer, call start_upload first and pass its uploadId here once the file is uploaded.",
    inputSchema: {
        type: "object",
        properties: {
            content: {
                type: "string",
                maxLength: MAX_CONTENT_CHARS,
                description:
                    "The full text to add: an artifact's source, a document's Markdown or text. Exactly as it is.",
            },
            format: {
                type: "string",
                enum: [...CONTENT_FORMATS],
                description:
                    "What content is. Claude artifacts: html, svg, mermaid, react (JSX/TSX), code or markdown. Documents: markdown or text.",
            },
            origin: {
                type: "string",
                enum: [...CONTENT_ORIGINS],
                description: "Where it came from; claude-artifact for a Claude artifact.",
            },
            title: {
                type: "string",
                maxLength: 200,
                description: "Its name in LaunchStack. Leave out to have one suggested.",
            },
            sourceUrl: {
                type: "string",
                maxLength: 2048,
                description: "A link to the original, e.g. a claude.ai or chatgpt.com share link.",
            },
            file: {
                type: "object",
                description: "A file the person attached in ChatGPT.",
                properties: {
                    download_url: { type: "string" },
                    file_id: { type: "string" },
                    mime_type: { type: "string" },
                    file_name: { type: "string" },
                },
                required: ["download_url"],
            },
            uploadId: {
                type: "string",
                description: "The uploadId from start_upload, once the file is uploaded.",
            },
            draftId: {
                type: "string",
                description:
                    "The draftId from an earlier add_document answer that asked where to put it.",
            },
            folder: {
                type: "string",
                maxLength: 256,
                description:
                    'Where to put it: a folder from the choices LaunchStack listed, "Unfiled" (only the person), or a new folder name. Leave out to ask.',
            },
            documentId: {
                type: ["string", "integer"],
                description: "Add a new version of this document instead of a new document.",
            },
            addAsNew: {
                type: "boolean",
                description:
                    "true to add it even though a document with the same title is in the folder.",
            },
        },
        additionalProperties: false,
    },
    outputSchema: {
        type: "object",
        properties: {
            status: {
                type: "string",
                enum: ["created", "version_added", "needs_input", "declined", "cancelled"],
            },
            documentId: { type: "integer" },
            title: { type: "string" },
            folder: { type: "string" },
            whoCanSee: { type: "string" },
            url: { type: "string" },
            createdFolder: { type: "boolean" },
            question: { type: "string", enum: ["folder", "duplicate"] },
            draftId: { type: "string" },
            uploadId: { type: "string" },
            suggestedTitle: { type: "string" },
            folders: {
                type: "array",
                items: {
                    type: "object",
                    properties: { path: { type: "string" }, whoCanSee: { type: "string" } },
                },
            },
            sameTitle: {
                type: "array",
                items: {
                    type: "object",
                    properties: { documentId: { type: "integer" }, title: { type: "string" } },
                },
            },
            expiresAt: { type: "string" },
        },
        required: ["status"],
    },
    annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
    },
    requires: { scope: MCP_SCOPE_WRITE, permission: "documents.upload" },
    rateLimit: ADD_DOCUMENT_RATE_LIMIT,
    meta: { "openai/fileParams": ["file"] },
    args,
    run,
});
