/**
 * Checking and normalising what an assistant sent to `save_conversation`.
 *
 * The caller is a model, so every refusal says exactly which field is wrong
 * and what would be accepted — a message it can act on in its next call. The
 * MCP tool validates its own schema too; this does not rely on that, because
 * the input is still untrusted JSON when it gets here.
 */
import { ASSISTANT_CLIENTS, type AssistantClient } from "~/server/db/schema/mcp";

import { ConversationSaveError } from "./types";

export const CONVERSATION_LIMITS = {
    titleChars: 200,
    messages: 2000,
    messageChars: 200_000,
    /** The rendered Markdown transcript, in bytes. */
    transcriptBytes: 2 * 1024 * 1024,
    modelChars: 100,
    clientNameChars: 128,
} as const;

export interface NormalizedMessage {
    role: "user" | "assistant";
    /** Line endings normalised and surrounding whitespace trimmed; never empty. */
    content: string;
    /** `YYYY-MM-DD HH:MM` for the turn heading, or null when unknown. */
    at: string | null;
}

export interface NormalizedConversation {
    /** One line, whitespace collapsed, 1–200 characters. */
    title: string;
    messages: NormalizedMessage[];
    conversationId: number | null;
    assistant: AssistantClient | null;
    model: string | null;
}

function invalid(message: string): ConversationSaveError {
    return new ConversationSaveError("invalid", message);
}

/** Collapse a free-text label to one trimmed line, or null when nothing is left. */
export function oneLine(value: string, maxChars: number): string | null {
    const line = value.replace(/\s+/g, " ").trim().slice(0, maxChars).trim();
    return line.length > 0 ? line : null;
}

/**
 * The time a turn heading shows. An ISO string keeps the wall-clock time the
 * assistant wrote (as imported agent sessions do); anything else that parses
 * is shown in UTC; anything that does not is left out rather than refused —
 * a bad timestamp is not worth failing a save over.
 */
export function formatTurnTime(timestamp: unknown): string | null {
    if (typeof timestamp !== "string") return null;
    const trimmed = timestamp.trim();
    const iso = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(trimmed);
    if (iso) return `${iso[1]} ${iso[2]}`;
    const parsed = Date.parse(trimmed);
    if (Number.isNaN(parsed)) return null;
    const utc = new Date(parsed).toISOString();
    return `${utc.slice(0, 10)} ${utc.slice(11, 16)} UTC`;
}

function normalizeConversationId(value: unknown): number | null {
    if (value === undefined || value === null) return null;
    const id =
        typeof value === "number"
            ? value
            : typeof value === "string" && /^\d+$/.test(value.trim())
              ? Number(value.trim())
              : Number.NaN;
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw invalid(
            "conversationId must be the positive integer an earlier save_conversation call returned. Leave it out to save a new conversation."
        );
    }
    return id;
}

function normalizeMessage(value: unknown, index: number): NormalizedMessage {
    const where = `messages[${index}]`;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw invalid(`${where} must be an object with "role" and "content".`);
    }
    const message = value as Record<string, unknown>;
    const role = message.role;
    if (role !== "user" && role !== "assistant") {
        throw invalid(
            `${where}.role must be "user" or "assistant" (got ${JSON.stringify(role ?? null)}). Leave out system and tool messages, or fold tool output into the assistant message.`
        );
    }
    if (typeof message.content !== "string") {
        throw invalid(`${where}.content must be a string of the message text.`);
    }
    if (message.content.length > CONVERSATION_LIMITS.messageChars) {
        throw invalid(
            `${where}.content is ${message.content.length.toLocaleString("en-US")} characters; the limit is ${CONVERSATION_LIMITS.messageChars.toLocaleString("en-US")} per message. Shorten it or split it across messages.`
        );
    }
    const content = message.content
        .replace(/\r\n?/g, "\n")
        // NUL cannot be stored or indexed; it never carries meaning in a chat.
        .replaceAll("\u0000", "")
        .trim();
    if (content.length === 0) {
        throw invalid(`${where}.content is empty. Every message needs some text.`);
    }
    return { role, content, at: formatTurnTime(message.timestamp) };
}

/** Validate and normalise the tool input; throws `ConversationSaveError("invalid")`. */
export function normalizeConversationInput(input: {
    title?: unknown;
    messages?: unknown;
    conversationId?: unknown;
    assistant?: unknown;
    model?: unknown;
}): NormalizedConversation {
    const rawTitle = typeof input.title === "string" ? input.title.replace(/\s+/g, " ").trim() : "";
    if (rawTitle.length === 0 || rawTitle.length > CONVERSATION_LIMITS.titleChars) {
        throw invalid(
            `title must be 1–${CONVERSATION_LIMITS.titleChars} characters after trimming (got ${rawTitle.length}). Use a short description of what the conversation was about.`
        );
    }

    const messages = input.messages;
    if (!Array.isArray(messages)) {
        throw invalid(
            'messages must be an array of { role: "user" | "assistant", content: string, timestamp?: string }.'
        );
    }
    if (messages.length === 0 || messages.length > CONVERSATION_LIMITS.messages) {
        throw invalid(
            `messages must contain between 1 and ${CONVERSATION_LIMITS.messages} messages (got ${messages.length}).${
                messages.length > CONVERSATION_LIMITS.messages
                    ? " Save the most relevant part, or split it into several conversations."
                    : ""
            }`
        );
    }

    let assistant: AssistantClient | null = null;
    if (input.assistant !== undefined && input.assistant !== null) {
        if (!(ASSISTANT_CLIENTS as readonly unknown[]).includes(input.assistant)) {
            throw invalid(
                `assistant must be one of ${ASSISTANT_CLIENTS.join(", ")} (got ${JSON.stringify(input.assistant)}).`
            );
        }
        assistant = input.assistant as AssistantClient;
    }

    let model: string | null = null;
    if (input.model !== undefined && input.model !== null) {
        if (typeof input.model !== "string") {
            throw invalid('model must be a string naming the model, e.g. "gpt-5" or "claude-opus".');
        }
        model = oneLine(input.model, CONVERSATION_LIMITS.modelChars);
    }

    return {
        title: rawTitle,
        messages: messages.map(normalizeMessage),
        conversationId: normalizeConversationId(input.conversationId),
        assistant,
        model,
    };
}
