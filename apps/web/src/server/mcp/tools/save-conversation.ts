/**
 * `save_conversation` — an assistant files the conversation it is having into
 * the workspace, as a document the team can search and open. The saving
 * itself (rendering, dedupe, the follow-up note) is the assistant-conversations
 * service's job; this tool validates what the model sent, hands it over, and
 * tells the model what happened in words it can relay.
 *
 * It needs the write scope and `documents.upload`: saving is adding a
 * document. A tighter rate limit than the server's applies on top.
 */
import { z } from "zod";

import {
    ConversationSaveError,
    saveAssistantConversation,
    type SaveConversationResult,
} from "~/server/assistant-conversations";
import { ASSISTANT_CLIENTS } from "~/server/db/schema/mcp";

import { MCP_SCOPE_WRITE } from "../config";
import { defineTool, type McpToolOutcome } from "../protocol";

export const SAVE_CONVERSATION_RATE_LIMIT = { maxRequests: 30, windowMs: 15 * 60 * 1000 };

const args = z.object({
    title: z.string().trim().min(1, "must not be empty").max(200),
    messages: z
        .array(
            z.object({
                role: z.enum(["user", "assistant"], {
                    errorMap: () => ({ message: 'must be "user" or "assistant"' }),
                }),
                content: z.string(),
                timestamp: z.string().trim().max(64).optional(),
            })
        )
        .min(1, "must hold at least one message")
        .max(2000, "must hold at most 2000 messages"),
    conversationId: z
        .preprocess(
            value =>
                typeof value === "string" && /^\s*\d+\s*$/.test(value) ? Number(value) : value,
            z.number().int().positive()
        )
        .optional(),
    assistant: z.enum(ASSISTANT_CLIENTS).optional(),
    model: z.string().trim().min(1).max(200).optional(),
});

/** What the model is told when the service refuses, per error code. */
export function describeSaveError(error: ConversationSaveError, conversationId?: number): string {
    switch (error.code) {
        case "invalid":
            return `LaunchStack could not save this conversation: ${error.message}. Fix the arguments and try again.`;
        case "too_large":
            return `This conversation is too large to save in one call: ${error.message}. Tell the person; do not drop or summarise turns to make it fit unless they ask you to.`;
        case "not_found":
            return `There is no saved conversation ${conversationId !== undefined ? `with conversationId ${conversationId} ` : ""}that this person can update in this workspace (${error.message}). To save it as a new conversation, call save_conversation again without conversationId.`;
        case "forbidden":
            return `This person is not allowed to save conversations to this LaunchStack workspace: ${error.message}. Tell them; a workspace admin can change their permissions.`;
    }
}

export function describeSaved(result: SaveConversationResult): string {
    const what =
        result.status === "created"
            ? `Saved the conversation "${result.title}" to LaunchStack.`
            : result.status === "updated"
              ? `Updated the saved conversation "${result.title}" in LaunchStack.`
              : `The saved conversation "${result.title}" was already up to date; nothing changed.`;
    const followUp =
        result.followUp === "queued" ? " LaunchStack is writing a follow-up note about it." : "";
    return (
        `${what}${followUp} Open it: ${result.url}\n` +
        `conversationId: ${result.conversationId}. When you save this same chat again, pass conversationId ${result.conversationId} so LaunchStack updates it instead of creating a copy.`
    );
}

export const saveConversationTool = defineTool({
    name: "save_conversation",
    title: "Save conversation to LaunchStack",
    description:
        "Save this conversation into the person's LaunchStack workspace as a document their team can search and open. " +
        "Only call it when the person asks you to save, sync or log the conversation to LaunchStack, or told you earlier to do it automatically; never on your own initiative. " +
        "Send every user and assistant turn so far, verbatim and in order (no summaries, no tool output), and a short descriptive title. " +
        "Returns conversationId, url and status (created, updated or unchanged). On later saves of the same chat, pass that conversationId to update it instead of creating a duplicate.",
    inputSchema: {
        type: "object",
        properties: {
            title: {
                type: "string",
                minLength: 1,
                maxLength: 200,
                description: "A short descriptive title for the conversation.",
            },
            messages: {
                type: "array",
                minItems: 1,
                maxItems: 2000,
                description: "Every user and assistant turn so far, verbatim, oldest first.",
                items: {
                    type: "object",
                    properties: {
                        role: { type: "string", enum: ["user", "assistant"] },
                        content: { type: "string", description: "The turn's full text." },
                        timestamp: {
                            type: "string",
                            description: "When it was said, ISO 8601, if known.",
                        },
                    },
                    required: ["role", "content"],
                    additionalProperties: false,
                },
            },
            conversationId: {
                type: "integer",
                minimum: 1,
                description:
                    "The conversationId a previous save of this same chat returned; updates that saved conversation.",
            },
            assistant: {
                type: "string",
                enum: [...ASSISTANT_CLIENTS],
                description: "Which assistant you are.",
            },
            model: {
                type: "string",
                maxLength: 200,
                description: "Your model name, if you know it.",
            },
        },
        required: ["title", "messages"],
        additionalProperties: false,
    },
    outputSchema: {
        type: "object",
        properties: {
            conversationId: { type: "integer" },
            status: { type: "string", enum: ["created", "updated", "unchanged"] },
            title: { type: "string" },
            url: { type: "string" },
            followUp: { type: "string", enum: ["queued", "unchanged", "skipped"] },
        },
        required: ["conversationId", "status", "title", "url", "followUp"],
    },
    annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        // A save without conversationId creates a new conversation each time.
        idempotentHint: false,
        openWorldHint: false,
    },
    requires: { scope: MCP_SCOPE_WRITE, permission: "documents.upload" },
    rateLimit: SAVE_CONVERSATION_RATE_LIMIT,
    args,
    async run(input, { principal, origin }): Promise<McpToolOutcome> {
        try {
            const result = await saveAssistantConversation({ ...input, principal, origin });
            return {
                ok: true,
                text: describeSaved(result),
                structured: { ...result },
            };
        } catch (error) {
            if (error instanceof ConversationSaveError) {
                return { ok: false, message: describeSaveError(error, input.conversationId) };
            }
            throw error;
        }
    },
});
