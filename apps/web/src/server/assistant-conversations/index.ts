/**
 * Conversations that assistants (Claude, ChatGPT, Gemini) save into a
 * workspace through the MCP server's `save_conversation` tool.
 *
 * STUB — the implementation lands in this directory; the exported shapes
 * below are the contract the MCP tool codes against. Keep them stable.
 */
import type { AssistantClient } from "~/server/db/schema/mcp";
import type { McpPrincipal } from "~/server/mcp/principal";

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

export async function saveAssistantConversation(
    _input: SaveConversationInput & { principal: McpPrincipal; origin: string }
): Promise<SaveConversationResult> {
    throw new ConversationSaveError("invalid", "Saving conversations is not available yet");
}
