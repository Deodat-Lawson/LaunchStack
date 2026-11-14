/**
 * `start_upload` — opens a one-time upload URL for a file on the person's
 * machine (a PDF, a Word file, slides). A CLI assistant (Claude Code, Codex)
 * sends the bytes with `curl -T`, then files them with
 * `add_document({ uploadId, folder })`. Web assistants cannot run curl and
 * should not call it.
 *
 * Opening a slot stores nothing in the workspace: the bytes wait, private to
 * this person, until add_document files them, and are swept after an hour.
 */
import { z } from "zod";

import { MCP_SCOPE_WRITE } from "../config";
import {
    SUPPORTED_FILE_EXTENSIONS,
    fileTypesFor,
    safeFilename,
    titleFromFilename,
} from "../document-content";
import { defineTool, type McpToolContext, type McpToolOutcome } from "../protocol";
import { MAX_STAGED_BYTES, createUploadSlot } from "../staging";
import type { StagedDetails } from "./add-document";

export const START_UPLOAD_RATE_LIMIT = { maxRequests: 30, windowMs: 15 * 60 * 1000 };

const args = z.object({
    filename: z.string().trim().min(1).max(256),
    title: z.string().trim().min(1).max(200).optional(),
    origin: z.string().trim().max(32).optional(),
});

type Args = z.infer<typeof args>;

/** The upload URL a slot's token opens. */
export function uploadUrl(origin: string, token: string): string {
    return `${origin.replace(/\/+$/, "")}/api/mcp/uploads/${token}`;
}

/** A shell-safe single-quoted path for the example command. */
function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function run(a: Args, context: McpToolContext): Promise<McpToolOutcome> {
    const types = fileTypesFor(a.filename);
    if (!types) {
        return {
            ok: false,
            message: `LaunchStack cannot read that kind of file ("${a.filename}"). Supported: ${SUPPORTED_FILE_EXTENSIONS.join(", ")}. For text you hold (Markdown, an artifact's source), call add_document with content instead.`,
        };
    }
    const { ctx } = context.principal;
    const details: StagedDetails = {
        suggestedTitle: a.title ?? titleFromFilename(a.filename),
        ingestMimeType: types.ingestMimeType,
        artifactType: types.artifactType,
        origin: a.origin ?? null,
        sourceUrl: null,
    };
    const slot = await createUploadSlot(
        { authUserId: ctx.authUserId, userPk: ctx.userPk, companyId: ctx.companyId },
        {
            filename: safeFilename(a.filename),
            mimeType: types.storageMimeType,
            details: { ...details },
        }
    );
    const url = uploadUrl(context.origin, slot.token);
    const command = `curl -sS --fail-with-body -T ${shellQuote(a.filename)} ${shellQuote(url)}`;
    return {
        ok: true,
        text:
            `Upload the file with this command (the link works once, until ${slot.uploadExpiresAt.toISOString()}, up to ${MAX_STAGED_BYTES / (1024 * 1024)} MB):\n` +
            `${command}\n` +
            `Use the file's real path in place of ${shellQuote(a.filename)} if it is elsewhere. When it succeeds, call add_document with uploadId "${slot.id}" (and the folder, if the person named one; otherwise LaunchStack will ask where it goes).`,
        structured: {
            uploadId: slot.id,
            uploadUrl: url,
            method: "PUT",
            command,
            maxBytes: MAX_STAGED_BYTES,
            uploadExpiresAt: slot.uploadExpiresAt.toISOString(),
            expiresAt: slot.expiresAt.toISOString(),
        },
    };
}

export const startUploadTool = defineTool({
    name: "start_upload",
    title: "Start uploading a file to LaunchStack",
    description:
        "Get a one-time upload link for a file on the person's computer (PDF, Word, slides, spreadsheet, image, audio), when the person asks to add that file to LaunchStack. " +
        "Only for assistants that can run shell commands (Claude Code, Codex): upload with the curl command it returns, then call add_document with the uploadId. " +
        "For text you already hold (Markdown, an artifact's source), call add_document with content instead.",
    inputSchema: {
        type: "object",
        properties: {
            filename: {
                type: "string",
                maxLength: 256,
                description: "The file's name with its extension, e.g. 'Q3 plan.pdf'.",
            },
            title: {
                type: "string",
                maxLength: 200,
                description: "Its name in LaunchStack, if the person gave one.",
            },
            origin: {
                type: "string",
                description:
                    "Where it came from, e.g. chatgpt for a document exported from ChatGPT.",
            },
        },
        required: ["filename"],
        additionalProperties: false,
    },
    outputSchema: {
        type: "object",
        properties: {
            uploadId: { type: "string" },
            uploadUrl: { type: "string" },
            method: { type: "string" },
            command: { type: "string" },
            maxBytes: { type: "integer" },
            uploadExpiresAt: { type: "string" },
            expiresAt: { type: "string" },
        },
        required: ["uploadId", "uploadUrl", "command"],
    },
    annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
    },
    requires: { scope: MCP_SCOPE_WRITE, permission: "documents.upload" },
    rateLimit: START_UPLOAD_RATE_LIMIT,
    args,
    run,
});
