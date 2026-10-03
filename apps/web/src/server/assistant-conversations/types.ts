/**
 * The `save_conversation` contract: what the MCP tool sends and gets back.
 * The MCP tool codes against these shapes (re-exported from `./index`);
 * keep them stable.
 */
import type { AssistantClient } from "~/server/db/schema/mcp";

export interface ConversationMessageInput {
    role: "user" | "assistant";
    content: string;
    /** ISO 8601, when the assistant knows it. */
    timestamp?: string;
}

export interface SaveConversationInput {
    title: string;
    messages: ConversationMessageInput[];
    /** The `conversationId` a previous save returned; updates that source. */
    conversationId?: number;
    /** Which assistant is saving, when it says; otherwise inferred from the credential. */
    assistant?: AssistantClient;
    /** Model name, when the assistant reports it (e.g. "gemini-3-pro"). */
    model?: string;
}

export interface SaveConversationResult {
    /** The workspace document id; pass back as `conversationId` to update it. */
    conversationId: number;
    status: "created" | "updated" | "unchanged";
    title: string;
    /** Absolute link that opens the conversation in LaunchStack. */
    url: string;
    /** Whether a follow-up note is being written for this save. */
    followUp: "queued" | "unchanged" | "skipped";
}

export type ConversationSaveErrorCode = "invalid" | "too_large" | "not_found" | "forbidden";

export class ConversationSaveError extends Error {
    constructor(
        readonly code: ConversationSaveErrorCode,
        message: string
    ) {
        super(message);
        this.name = "ConversationSaveError";
    }
}
