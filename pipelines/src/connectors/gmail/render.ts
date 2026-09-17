/**
 * A Gmail thread as one Markdown document, plus the helpers that get there:
 * header lookup, base64url decoding, HTML → text, quoted-reply trimming,
 * attachment enumeration, and the thread fingerprint.
 *
 * Messages are immutable in Gmail, so the set of (non-draft) message ids IS
 * the content identity of a thread: a reply changes it, a label or read/unread
 * flip does not. That is what keeps a mailbox sync from re-embedding a thread
 * every time someone opens it.
 */

import { createHash } from "node:crypto";

import type { GmailMessage, GmailPart, GmailThread } from "./client";

export function headerValue(
    headers: readonly { name: string; value: string }[] | undefined,
    name: string
): string | null {
    if (!headers) return null;
    const wanted = name.toLowerCase();
    for (const header of headers) {
        if (header.name.toLowerCase() === wanted) return header.value;
    }
    return null;
}

export function decodeBase64Url(data: string): string {
    return Buffer.from(data, "base64url").toString("utf8");
}

export function decodeBase64UrlBytes(data: string): Uint8Array {
    return new Uint8Array(Buffer.from(data, "base64url"));
}

const NAMED_ENTITIES: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ndash: "–",
    mdash: "—",
    hellip: "…",
    copy: "©",
    reg: "®",
    trade: "™",
    lsquo: "‘",
    rsquo: "’",
    ldquo: "“",
    rdquo: "”",
};

function decodeEntities(text: string): string {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
        const lower = entity.toLowerCase();
        if (lower.startsWith("#x")) {
            const code = Number.parseInt(lower.slice(2), 16);
            return Number.isFinite(code) ? String.fromCodePoint(code) : match;
        }
        if (lower.startsWith("#")) {
            const code = Number.parseInt(lower.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : match;
        }
        return NAMED_ENTITIES[lower] ?? match;
    });
}

/**
 * Good-enough HTML to text for email bodies: drops scripts, styles and
 * hidden preheaders, turns block boundaries into newlines, keeps link
 * targets when they differ from the anchor text, and decodes entities.
 */
export function htmlToText(html: string): string {
    let text = html
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<(script|style|head|title)[\s\S]*?<\/\1>/gi, "")
        .replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|pre|table|section|article|header|footer)>/gi, "\n")
        .replace(/<(li)[^>]*>/gi, "- ")
        .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
            const plain = label.replace(/<[^>]+>/g, "").trim();
            if (!plain) return "";
            if (!href || href.startsWith("mailto:") || plain === href) return plain;
            return `${plain} (${href})`;
        })
        .replace(/<[^>]+>/g, "");
    text = decodeEntities(text);
    return text
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

export interface MessageBody {
    readonly text: string;
    readonly source: "text" | "html" | "none";
}

function walkParts(part: GmailPart | undefined, visit: (part: GmailPart) => void): void {
    if (!part) return;
    visit(part);
    for (const child of part.parts ?? []) walkParts(child, visit);
}

/** The message body as text: the text/plain part when it exists, else HTML converted. */
export function extractMessageBody(payload: GmailPart | undefined): MessageBody {
    let plain: string | null = null;
    let html: string | null = null;
    walkParts(payload, part => {
        if (part.filename) return; // attachments, even text/plain ones
        const data = part.body?.data;
        if (!data) return;
        const mime = (part.mimeType ?? "").toLowerCase();
        if (mime === "text/plain" && plain === null) plain = decodeBase64Url(data);
        else if (mime === "text/html" && html === null) html = decodeBase64Url(data);
    });
    if (plain !== null && (plain as string).trim().length > 0) {
        return { text: (plain as string).replace(/\r\n?/g, "\n").trim(), source: "text" };
    }
    if (html !== null) return { text: htmlToText(html), source: "html" };
    return { text: "", source: "none" };
}

/**
 * Drop the quoted history a reply drags along. Conservative: only trailing
 * `>`-prefixed blocks, the "On … wrote:" line that introduces them, and
 * Outlook's "-----Original Message-----" separator onward.
 */
export function stripQuotedReply(text: string): string {
    const lines = text.split("\n");
    let cut = lines.length;
    // Walk up from the end while lines are quoted or blank.
    let index = lines.length - 1;
    while (index >= 0) {
        const line = lines[index] ?? "";
        if (line.trim() === "" || line.trimStart().startsWith(">")) {
            index--;
            continue;
        }
        break;
    }
    const lastContent = index;
    // Everything after the last unquoted line is quote; if that last line is
    // the "On … wrote:" introducer, drop it too.
    if (lastContent < lines.length - 1) {
        cut = lastContent + 1;
        const introducer = lines[lastContent] ?? "";
        if (/^On .+wrote:\s*$/i.test(introducer.trim()) || /^Le .+a écrit\s*:\s*$/i.test(introducer.trim())) {
            cut = lastContent;
        }
    }
    let kept = lines.slice(0, cut);
    const separator = kept.findIndex(line =>
        /^-{2,}\s*(Original Message|Forwarded message|Mensaje original)\s*-{2,}$/i.test(line.trim())
    );
    if (separator > 0) kept = kept.slice(0, separator);
    return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function isDraft(message: GmailMessage): boolean {
    return (message.labelIds ?? []).includes("DRAFT");
}

function messageTime(message: GmailMessage): number {
    const internal = Number(message.internalDate);
    if (Number.isFinite(internal) && internal > 0) return internal;
    const header = headerValue(message.payload?.headers, "Date");
    const parsed = header ? Date.parse(header) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : 0;
}

/** The thread's real messages: drafts dropped, oldest first. */
export function threadMessages(thread: GmailThread): GmailMessage[] {
    return (thread.messages ?? [])
        .filter(message => !isDraft(message))
        .sort((a, b) => messageTime(a) - messageTime(b));
}

/** Order-independent identity of a message set. Prefixed so a later scheme cannot collide. */
export function threadFingerprint(messageIds: readonly string[]): string {
    const hash = createHash("sha256");
    hash.update([...messageIds].sort().join("\n"));
    return `msgs:${hash.digest("hex")}`;
}

const SUBJECT_PREFIX = /^\s*((re|fw|fwd|aw|wg|tr|sv|vs)\s*:\s*)+/i;

export function cleanSubject(subject: string | null | undefined): string {
    const trimmed = (subject ?? "").replace(SUBJECT_PREFIX, "").replace(/\s+/g, " ").trim();
    return trimmed || "(no subject)";
}

export function threadSubject(messages: readonly GmailMessage[]): string {
    for (const message of messages) {
        const subject = headerValue(message.payload?.headers, "Subject");
        if (subject?.trim()) return cleanSubject(subject);
    }
    return "(no subject)";
}

export interface GmailAttachmentRef {
    readonly messageId: string;
    readonly partId: string;
    readonly filename: string;
    readonly mimeType: string;
    readonly size: number;
    /** Set when the bytes must be fetched; null when `inlineData` carries them. */
    readonly attachmentId: string | null;
    readonly inlineData: string | null;
}

/** Every named part of a message that carries bytes — attachments, inline images included. */
export function listMessageAttachments(message: GmailMessage): GmailAttachmentRef[] {
    const refs: GmailAttachmentRef[] = [];
    walkParts(message.payload, part => {
        if (!part.filename) return;
        const attachmentId = part.body?.attachmentId ?? null;
        const inlineData = part.body?.data ?? null;
        if (!attachmentId && !inlineData) return;
        refs.push({
            messageId: message.id,
            partId: part.partId ?? String(refs.length),
            filename: part.filename,
            mimeType: (part.mimeType ?? "application/octet-stream").toLowerCase(),
            size: part.body?.size ?? 0,
            attachmentId,
            inlineData,
        });
    });
    return refs;
}

/** A blob-safe filename: flat, ASCII-ish, extension preserved. */
export function safeFilename(name: string, fallback = "attachment"): string {
    const flattened = name
        .normalize("NFKD")
        .replace(/[^\x20-\x7e]/g, "")
        .replace(/[\\/:*?"<>|]+/g, "-")
        .replace(/\s+/g, " ")
        .trim();
    return flattened || fallback;
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

/** Addresses in a header, e.g. `Ada Lovelace <ada@x.com>, bob@y.com`, tidied. */
function displayAddresses(value: string | null): string {
    if (!value) return "";
    return value
        .split(",")
        .map(part => part.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join(", ");
}

function senderDisplay(from: string | null): string {
    if (!from) return "Unknown sender";
    const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
    if (match) {
        const name = match[1]?.trim();
        const email = match[2]?.trim();
        return name ? `${name} <${email}>` : (email ?? from);
    }
    return from.trim();
}

/** Ids of the labels nobody wants in a document header. */
const HIDDEN_LABEL_IDS = new Set([
    "INBOX",
    "SENT",
    "UNREAD",
    "IMPORTANT",
    "STARRED",
    "DRAFT",
    "SPAM",
    "TRASH",
    "CHAT",
    "CATEGORY_PERSONAL",
    "CATEGORY_SOCIAL",
    "CATEGORY_PROMOTIONS",
    "CATEGORY_UPDATES",
    "CATEGORY_FORUMS",
]);

export function threadLabelNames(
    messages: readonly GmailMessage[],
    labelNames: ReadonlyMap<string, string> | undefined
): string[] {
    const ids = new Set<string>();
    for (const message of messages) for (const id of message.labelIds ?? []) ids.add(id);
    const names: string[] = [];
    for (const id of ids) {
        if (HIDDEN_LABEL_IDS.has(id)) continue;
        names.push(labelNames?.get(id) ?? id);
    }
    return names.sort((a, b) => a.localeCompare(b));
}

export function gmailThreadLink(threadId: string, accountEmail?: string | null): string {
    const base = accountEmail
        ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(accountEmail)}`
        : "https://mail.google.com/mail/";
    return `${base}#all/${encodeURIComponent(threadId)}`;
}

export interface RenderThreadOptions {
    readonly thread: GmailThread;
    readonly labelNames?: ReadonlyMap<string, string>;
    readonly accountEmail?: string | null;
    /** Per-message body cap; the whole item is capped again by the sync. */
    readonly maxBodyChars?: number;
}

export interface RenderedThread {
    readonly markdown: string;
    readonly subject: string;
    readonly messages: readonly GmailMessage[];
    readonly participants: readonly string[];
    readonly firstMessageAt: string | null;
    readonly lastMessageAt: string | null;
    readonly labels: readonly string[];
    readonly attachments: readonly GmailAttachmentRef[];
}

export function renderThread(options: RenderThreadOptions): RenderedThread {
    const messages = threadMessages(options.thread);
    const subject = threadSubject(messages);
    const maxBodyChars = options.maxBodyChars ?? 200_000;
    const labels = threadLabelNames(messages, options.labelNames);

    const participants: string[] = [];
    const seen = new Set<string>();
    for (const message of messages) {
        const from = senderDisplay(headerValue(message.payload?.headers, "From"));
        if (!seen.has(from)) {
            seen.add(from);
            participants.push(from);
        }
    }

    const times = messages.map(messageTime).filter(ms => ms > 0);
    const firstMs = times.length ? Math.min(...times) : 0;
    const lastMs = times.length ? Math.max(...times) : 0;

    const attachments: GmailAttachmentRef[] = [];
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
        `Gmail thread · ${messages.length} message${messages.length === 1 ? "" : "s"} · ${who} · ${when}`
    );
    if (labels.length > 0) lines.push(`Labels: ${labels.join(", ")}`);
    lines.push(`Source: ${gmailThreadLink(options.thread.id, options.accountEmail)}`, "");

    for (const message of messages) {
        const headers = message.payload?.headers;
        const from = senderDisplay(headerValue(headers, "From"));
        const to = displayAddresses(headerValue(headers, "To"));
        const cc = displayAddresses(headerValue(headers, "Cc"));
        const messageSubject = cleanSubject(headerValue(headers, "Subject"));
        const body = stripQuotedReply(extractMessageBody(message.payload).text);
        const clipped =
            body.length > maxBodyChars ? `${body.slice(0, maxBodyChars)}\n\n[… truncated]` : body;

        lines.push("---", "", `## ${from} · ${formatDate(messageTime(message))}`, "");
        if (to) lines.push(`**To:** ${to}  `);
        if (cc) lines.push(`**Cc:** ${cc}  `);
        if (messageSubject !== subject && messageSubject !== "(no subject)") {
            lines.push(`**Subject:** ${messageSubject}  `);
        }
        if (to || cc) lines.push("");
        lines.push(clipped || "_(empty message)_", "");

        const refs = listMessageAttachments(message);
        if (refs.length > 0) {
            attachments.push(...refs);
            lines.push(
                `**Attachments:** ${refs
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
        labels,
        attachments,
    };
}
