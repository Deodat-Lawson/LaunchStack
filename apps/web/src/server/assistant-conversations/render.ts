/**
 * A saved conversation as Markdown, in the transcript grammar the
 * conversation viewer already reads (~/lib/session-transcript):
 *
 *     # <title>
 *
 *     > Saved from Claude (Claude Code) · 2026-10-16 14:03 UTC · 12 messages · model X
 *
 *     ## User — 2026-10-16 13:58
 *
 *     <message>
 *
 *     ## Assistant — 2026-10-16 13:59
 *
 *     <message>
 *
 * The rendered file is what gets chunked and embedded, so the `##` speaker
 * headings line up with the heading-aware chunker and the provenance travels
 * in the text itself. A message line that would read as a speaker heading is
 * escaped with a leading backslash (`escapeConversationLine`); the parser
 * removes it, so render → parse gives back the same turns.
 *
 * The content hash covers the title and the turns but not the provenance
 * line: the save time (and which connection did the saving) must not make an
 * identical re-save look like a change.
 */
import { createHash } from "node:crypto";

import {
    ASSISTANT_LABELS,
    SAVED_CONVERSATION_PROVENANCE_PREFIX,
    escapeConversationLine,
} from "~/lib/session-transcript";
import type { AssistantClient } from "~/server/db/schema/mcp";

import { ConversationSaveError } from "./types";
import { CONVERSATION_LIMITS, type NormalizedConversation } from "./validate";

export interface ConversationProvenance {
    family: AssistantClient;
    /** The connection's own name ("Claude Code", an access key's name), when known. */
    clientName: string | null;
    model: string | null;
    savedAt: Date;
}

type Renderable = Pick<NormalizedConversation, "title" | "messages">;

function formatSavedAt(savedAt: Date): string {
    const iso = savedAt.toISOString();
    return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** "Saved from Claude (Claude Code) · 2026-10-16 14:03 UTC · 12 messages · model X" */
export function provenanceLine(provenance: ConversationProvenance, messageCount: number): string {
    const label = ASSISTANT_LABELS[provenance.family];
    const client =
        provenance.clientName && provenance.clientName.toLowerCase() !== label.toLowerCase()
            ? ` (${provenance.clientName})`
            : "";
    const parts = [
        `${SAVED_CONVERSATION_PROVENANCE_PREFIX}${label}${client}`,
        formatSavedAt(provenance.savedAt),
        `${messageCount} ${messageCount === 1 ? "message" : "messages"}`,
    ];
    if (provenance.model) parts.push(`model ${provenance.model}`);
    return parts.join(" · ");
}

function renderTurns(conversation: Renderable): string {
    const blocks = conversation.messages.map(message => {
        const speaker = message.role === "user" ? "User" : "Assistant";
        const heading = `## ${speaker}${message.at ? ` — ${message.at}` : ""}`;
        const body = message.content.split("\n").map(escapeConversationLine).join("\n");
        return `${heading}\n\n${body}`;
    });
    return blocks.join("\n\n");
}

/** Title and turns only — the part the content hash covers. */
export function renderConversationBody(conversation: Renderable): string {
    return `# ${conversation.title}\n\n${renderTurns(conversation)}\n`;
}

export function renderConversationMarkdown(
    conversation: Renderable,
    provenance: ConversationProvenance
): string {
    const line = provenanceLine(provenance, conversation.messages.length);
    return `# ${conversation.title}\n\n> ${line}\n\n${renderTurns(conversation)}\n`;
}

/** SHA-256 hex of the title and turns; equal hashes mean nothing worth a new version changed. */
export function conversationContentHash(conversation: Renderable): string {
    return createHash("sha256").update(renderConversationBody(conversation), "utf8").digest("hex");
}

/** Refuse a transcript over the size limit, with numbers the caller can act on. */
export function assertTranscriptSize(markdown: string): void {
    const bytes = Buffer.byteLength(markdown, "utf8");
    if (bytes <= CONVERSATION_LIMITS.transcriptBytes) return;
    const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);
    throw new ConversationSaveError(
        "too_large",
        `The conversation renders to ${mb(bytes)} MB; the limit is ${mb(CONVERSATION_LIMITS.transcriptBytes)} MB. Save the most relevant part, or split it into several conversations.`
    );
}

/** A storage-safe file name for the transcript. */
export function conversationFilename(title: string): string {
    const base =
        title
            .replace(/[^a-zA-Z0-9\s\-_]/g, "")
            .trim()
            .replace(/\s+/g, "-")
            .slice(0, 100) || "conversation";
    return `${base}.md`;
}
