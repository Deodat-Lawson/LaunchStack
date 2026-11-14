/**
 * An Outlook conversation as one Markdown document — the Gmail thread
 * renderer's sibling, sharing its text helpers (quoted-reply trimming, HTML →
 * text, subject cleaning, the message-set fingerprint) so a thread reads the
 * same whichever mailbox it came from.
 *
 * Messages keep their id for life under immutable ids, so the set of
 * (non-draft) message ids IS the content identity of a conversation: a reply
 * changes it, a move between folders or a read/unread flip does not.
 */

import { cleanSubject, htmlToText, stripQuotedReply, threadFingerprint } from "../gmail/render";
import type { OutlookAttachment, OutlookMessage, OutlookRecipient } from "./client";

/** Order-independent identity of a message set: `msgs:<sha256>`, as for Gmail threads. */
export function conversationFingerprint(messageIds: readonly string[]): string {
    return threadFingerprint(messageIds);
}

function messageTime(message: OutlookMessage): number {
    for (const stamp of [message.receivedDateTime, message.sentDateTime]) {
        const parsed = stamp ? Date.parse(stamp) : Number.NaN;
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return 0;
}

/** The conversation's real messages: drafts dropped, oldest first. */
export function conversationMessages(messages: readonly OutlookMessage[]): OutlookMessage[] {
    return messages
        .filter(message => !message.isDraft)
        .sort((a, b) => messageTime(a) - messageTime(b) || a.id.localeCompare(b.id));
}

export function conversationSubject(messages: readonly OutlookMessage[]): string {
    for (const message of messages) {
        if (message.subject?.trim()) return cleanSubject(message.subject);
    }
    return "(no subject)";
}

/** The newest message's link — where "Open in Outlook" should land. */
export function conversationLink(messages: readonly OutlookMessage[]): string | null {
    const ordered = conversationMessages(messages);
    for (let index = ordered.length - 1; index >= 0; index--) {
        const link = ordered[index]?.webLink;
        if (link) return link;
    }
    return null;
}

/**
 * Outlook replies quote by header block, not by `>`: a rule of underscores
 * (or nothing at all) and then `From:` / `Sent:` lines. Gmail's trimmer
 * handles the `>` and "On … wrote:" styles; this adds Outlook's own on top.
 */
export function stripOutlookQuotedReply(text: string): string {
    const lines = stripQuotedReply(text.replace(/\r\n?/g, "\n")).split("\n");

    function nextContent(from: number): string {
        for (let index = from; index < lines.length; index++) {
            const line = (lines[index] ?? "").trim();
            if (line) return line;
        }
        return "";
    }

    let cut = -1;
    for (let index = 0; index < lines.length; index++) {
        const line = (lines[index] ?? "").trim();
        if (/^_{8,}$/.test(line) && /^From:\s/i.test(nextContent(index + 1))) {
            cut = index;
            break;
        }
        if (/^From:\s/i.test(line) && /^(Sent|Date):\s/i.test(nextContent(index + 1))) {
            cut = index;
            break;
        }
    }
    // A message that is nothing but a forwarded block keeps it: cutting at
    // the first line would leave an empty message.
    const kept = cut > 0 ? lines.slice(0, cut) : lines;
    return kept
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/** The message body as text; HTML is converted in case a server ignored the Prefer header. */
export function messageBodyText(message: OutlookMessage): string {
    const content = message.body?.content ?? "";
    const isHtml = (message.body?.contentType ?? "text").toLowerCase() === "html";
    const text = isHtml ? htmlToText(content) : content.replace(/\r\n?/g, "\n").trim();
    return text || (message.bodyPreview ?? "").trim();
}

function recipientDisplay(recipient: OutlookRecipient | null | undefined): string {
    const name = recipient?.emailAddress?.name?.trim();
    const address = recipient?.emailAddress?.address?.trim();
    if (name && address && name !== address) return `${name} <${address}>`;
    if (address) return address;
    return name ?? "";
}

function senderDisplay(message: OutlookMessage): string {
    return recipientDisplay(message.from) || "Unknown sender";
}

function recipientList(recipients: readonly OutlookRecipient[] | undefined): string {
    return (recipients ?? []).map(recipientDisplay).filter(Boolean).join(", ");
}

function formatBytes(size: number): string {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ms: number): string {
    if (!ms) return "unknown date";
    return new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export interface OutlookAttachmentRef {
    readonly messageId: string;
    readonly attachmentId: string;
    readonly filename: string;
    readonly mimeType: string;
    readonly size: number;
    readonly isInline: boolean;
}

export function toAttachmentRef(
    messageId: string,
    attachment: OutlookAttachment
): OutlookAttachmentRef {
    const name = attachment.name?.trim() ?? "";
    return {
        messageId,
        attachmentId: attachment.id,
        filename: name.length > 0 ? name : "attachment",
        mimeType: (attachment.contentType ?? "application/octet-stream").toLowerCase(),
        size: attachment.size ?? 0,
        isInline: attachment.isInline ?? false,
    };
}

/** Folders nobody wants in a document header. */
const HIDDEN_FOLDER_NAMES = new Set(["inbox", "sentitems", "drafts", "deleteditems", "junkemail"]);

export interface OutlookFolderLabel {
    readonly displayName: string;
    readonly wellKnownName?: string | null;
}

export function conversationFolderNames(
    messages: readonly OutlookMessage[],
    folders: ReadonlyMap<string, OutlookFolderLabel> | undefined
): string[] {
    const names = new Set<string>();
    for (const message of messages) {
        const folder = message.parentFolderId ? folders?.get(message.parentFolderId) : undefined;
        if (!folder) continue;
        if (folder.wellKnownName && HIDDEN_FOLDER_NAMES.has(folder.wellKnownName.toLowerCase())) {
            continue;
        }
        names.add(folder.displayName);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
}

export interface RenderConversationOptions {
    readonly conversationId: string;
    /** Every message of the conversation, drafts included; they are dropped here. */
    readonly messages: readonly OutlookMessage[];
    /** Attachments per message id, as listed. Inline ones are left out of the document. */
    readonly attachments?: ReadonlyMap<string, readonly OutlookAttachmentRef[]>;
    /** Folder id → name, for the header's `Folders:` line. */
    readonly folders?: ReadonlyMap<string, OutlookFolderLabel>;
    /** Per-message body cap; the whole item is capped again by the sync. */
    readonly maxBodyChars?: number;
}

export interface RenderedConversation {
    readonly markdown: string;
    readonly subject: string;
    readonly messages: readonly OutlookMessage[];
    readonly participants: readonly string[];
    readonly firstMessageAt: string | null;
    readonly lastMessageAt: string | null;
    readonly folders: readonly string[];
    /** The newest message's `webLink`. */
    readonly link: string | null;
    /** File attachments, inline ones excluded. */
    readonly attachments: readonly OutlookAttachmentRef[];
    /** Inline attachments — embedded images — listed so the sync can report them skipped. */
    readonly inlineAttachments: readonly OutlookAttachmentRef[];
}

export function renderConversation(options: RenderConversationOptions): RenderedConversation {
    const messages = conversationMessages(options.messages);
    const subject = conversationSubject(messages);
    const maxBodyChars = options.maxBodyChars ?? 200_000;
    const folders = conversationFolderNames(messages, options.folders);
    const link = conversationLink(messages);

    const participants: string[] = [];
    const seen = new Set<string>();
    for (const message of messages) {
        const from = senderDisplay(message);
        if (!seen.has(from)) {
            seen.add(from);
            participants.push(from);
        }
    }

    const times = messages.map(messageTime).filter(ms => ms > 0);
    const firstMs = times.length ? Math.min(...times) : 0;
    const lastMs = times.length ? Math.max(...times) : 0;

    const attachments: OutlookAttachmentRef[] = [];
    const inlineAttachments: OutlookAttachmentRef[] = [];
    const lines: string[] = [];
    lines.push(`# ${subject}`, "");
    const who =
        participants.length <= 4
            ? participants.join(", ")
            : `${participants.slice(0, 4).join(", ")} +${participants.length - 4} more`;
    const when =
        firstMs && lastMs && firstMs !== lastMs
            ? `${formatDate(firstMs)} – ${formatDate(lastMs)}`
            : formatDate(lastMs || firstMs);
    lines.push(
        `Outlook conversation · ${messages.length} message${messages.length === 1 ? "" : "s"} · ${who} · ${when}`
    );
    if (folders.length > 0) lines.push(`Folders: ${folders.join(", ")}`);
    if (link) lines.push(`Source: ${link}`);
    lines.push("");

    for (const message of messages) {
        const to = recipientList(message.toRecipients);
        const cc = recipientList(message.ccRecipients);
        const messageSubject = cleanSubject(message.subject);
        const body = stripOutlookQuotedReply(messageBodyText(message));
        const clipped =
            body.length > maxBodyChars ? `${body.slice(0, maxBodyChars)}\n\n[… truncated]` : body;

        lines.push(
            "---",
            "",
            `## ${senderDisplay(message)} · ${formatDate(messageTime(message))}`,
            ""
        );
        if (to) lines.push(`**To:** ${to}  `);
        if (cc) lines.push(`**Cc:** ${cc}  `);
        if (messageSubject !== subject && messageSubject !== "(no subject)") {
            lines.push(`**Subject:** ${messageSubject}  `);
        }
        if (to || cc) lines.push("");
        lines.push(clipped || "_(empty message)_", "");

        const refs = options.attachments?.get(message.id) ?? [];
        const files = refs.filter(ref => !ref.isInline);
        inlineAttachments.push(...refs.filter(ref => ref.isInline));
        if (files.length > 0) {
            attachments.push(...files);
            lines.push(
                `**Attachments:** ${files
                    .map(ref => `${ref.filename} (${formatBytes(ref.size)})`)
                    .join(", ")}`,
                ""
            );
        }
    }

    return {
        markdown: lines.join("\n").trimEnd() + "\n",
        subject,
        messages,
        participants,
        firstMessageAt: firstMs ? new Date(firstMs).toISOString() : null,
        lastMessageAt: lastMs ? new Date(lastMs).toISOString() : null,
        folders,
        link,
        attachments,
        inlineAttachments,
    };
}
