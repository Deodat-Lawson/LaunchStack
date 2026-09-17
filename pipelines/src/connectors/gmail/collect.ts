/**
 * Thread reference → `KnowledgeItem`s with real content: the rendered thread
 * as Markdown, and each ingestible attachment as its own item. Size caps and
 * unsupported formats become skips with reasons — one oversized PDF must not
 * abort a mailbox sync.
 */

import type { DiscoveredKnowledgeItem, KnowledgeItem, SkippedKnowledgeItem } from "../types";
import { GmailNotFoundError, type GmailClient, type GmailThread } from "./client";
import { describeError, GMAIL_CONNECTOR_ID, type GmailDiscoveredThread } from "./discover";
import {
    decodeBase64UrlBytes,
    gmailThreadLink,
    renderThread,
    safeFilename,
    threadFingerprint,
    type GmailAttachmentRef,
    type RenderedThread,
} from "./render";

/** Gmail's own attachment ceiling; nothing larger exists to fetch. */
export const DEFAULT_MAX_ITEM_BYTES = 25 * 1024 * 1024;

/**
 * Attachment formats the ingestion router can turn into text. Images are
 * deliberately out: an inline logo in every signature would become a
 * document each.
 */
export const DEFAULT_ATTACHMENT_MIME_ALLOWLIST: readonly string[] = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-powerpoint",
    "text/plain",
    "text/markdown",
    "text/csv",
];

const EXTENSION_BY_MIME: Record<string, string> = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/vnd.ms-powerpoint": ".ppt",
    "text/plain": ".txt",
    "text/markdown": ".md",
    "text/csv": ".csv",
};

const MIME_BY_EXTENSION: Record<string, string> = Object.fromEntries(
    Object.entries(EXTENSION_BY_MIME).map(([mime, ext]) => [ext, mime])
);

export interface GmailThreadItemMetadata {
    readonly gmailThreadId: string;
    readonly gmailLink: string;
    readonly subject: string;
    readonly messageCount: number;
    readonly participants: readonly string[];
    readonly firstMessageAt: string | null;
    readonly lastMessageAt: string | null;
    readonly labels: readonly string[];
    readonly matchedSelectors: readonly string[];
    readonly attachmentCount: number;
    readonly extension: string;
}

export function threadSourceId(threadId: string): string {
    return threadId;
}

export function attachmentSourceId(threadId: string, ref: GmailAttachmentRef): string {
    return `${threadId}:${ref.messageId}:${ref.partId}`;
}

/** The thread id an item's source id belongs to (attachments are `thread:message:part`). */
export function threadIdOfSourceId(sourceId: string): string {
    const colon = sourceId.indexOf(":");
    return colon === -1 ? sourceId : sourceId.slice(0, colon);
}

/** Messages never change, so an attachment's identity is its address. */
export function attachmentFingerprint(ref: GmailAttachmentRef): string {
    return `att:${ref.messageId}:${ref.partId}`;
}

function attachmentExtension(ref: GmailAttachmentRef): string | null {
    const dot = ref.filename.lastIndexOf(".");
    const fromName = dot > 0 ? ref.filename.slice(dot).toLowerCase() : null;
    if (fromName && MIME_BY_EXTENSION[fromName]) return fromName;
    return EXTENSION_BY_MIME[ref.mimeType] ?? null;
}

export interface AttachmentPolicy {
    readonly mimeAllowlist?: readonly string[];
    readonly maxBytes?: number;
}

/** Why an attachment will not be ingested, or null when it will. */
export function attachmentExclusion(ref: GmailAttachmentRef, policy: AttachmentPolicy): string | null {
    const allow = policy.mimeAllowlist ?? DEFAULT_ATTACHMENT_MIME_ALLOWLIST;
    const extension = attachmentExtension(ref);
    const mime = extension ? (MIME_BY_EXTENSION[extension] ?? ref.mimeType) : ref.mimeType;
    if (!allow.includes(mime)) return `unsupported attachment type ${ref.mimeType}`;
    const maxBytes = policy.maxBytes ?? DEFAULT_MAX_ITEM_BYTES;
    if (ref.size > maxBytes) return `${ref.size} bytes exceeds the ${maxBytes}-byte cap`;
    return null;
}

export function toThreadDiscoveredItem(
    discovered: GmailDiscoveredThread,
    accountEmail: string | null | undefined
): DiscoveredKnowledgeItem {
    return {
        sourceId: threadSourceId(discovered.threadId),
        connectorId: GMAIL_CONNECTOR_ID,
        title: discovered.snippet || discovered.threadId,
        kind: "gmail-thread",
        mimeType: "text/markdown",
        bytes: 0,
        modifiedAt: "",
        location: {
            origin: gmailThreadLink(discovered.threadId, accountEmail),
            relativePath: `${discovered.threadId}.md`,
        },
        metadata: { gmailThreadId: discovered.threadId, extension: ".md" },
    };
}

export function toAttachmentDiscoveredItem(
    threadId: string,
    ref: GmailAttachmentRef,
    rendered: Pick<RenderedThread, "subject" | "lastMessageAt">,
    accountEmail: string | null | undefined
): DiscoveredKnowledgeItem {
    const extension = attachmentExtension(ref) ?? "";
    const base = safeFilename(ref.filename);
    const title = extension && !base.toLowerCase().endsWith(extension) ? `${base}${extension}` : base;
    return {
        sourceId: attachmentSourceId(threadId, ref),
        connectorId: GMAIL_CONNECTOR_ID,
        title,
        kind: "gmail-attachment",
        mimeType: MIME_BY_EXTENSION[extension] ?? ref.mimeType,
        bytes: ref.size,
        modifiedAt: rendered.lastMessageAt ?? "",
        location: {
            origin: gmailThreadLink(threadId, accountEmail),
            relativePath: `${threadId}/${title}`,
        },
        metadata: {
            gmailThreadId: threadId,
            gmailMessageId: ref.messageId,
            gmailPartId: ref.partId,
            subject: rendered.subject,
            originalFilename: ref.filename,
            extension,
        },
    };
}

export type CollectThreadOutcome =
    | {
          readonly kind: "item";
          readonly value: KnowledgeItem;
          readonly rendered: RenderedThread;
          readonly thread: GmailThread;
      }
    | { readonly kind: "skipped"; readonly value: SkippedKnowledgeItem }
    | { readonly kind: "not-found"; readonly threadId: string };

export interface CollectThreadOptions {
    readonly labelNames?: ReadonlyMap<string, string>;
    readonly accountEmail?: string | null;
    readonly maxItemBytes?: number;
    /** An already-fetched full thread (the sync fetches it when the fingerprint check passed). */
    readonly thread?: GmailThread;
}

export async function collectGmailThread(
    client: GmailClient,
    discovered: GmailDiscoveredThread,
    options: CollectThreadOptions = {}
): Promise<CollectThreadOutcome> {
    const maxItemBytes = options.maxItemBytes ?? DEFAULT_MAX_ITEM_BYTES;
    let thread: GmailThread;
    try {
        thread = options.thread ?? (await client.getThread(discovered.threadId, "full"));
    } catch (error) {
        if (error instanceof GmailNotFoundError) {
            return { kind: "not-found", threadId: discovered.threadId };
        }
        return {
            kind: "skipped",
            value: {
                sourceId: discovered.threadId,
                reason: "unreadable",
                detail: describeError(error),
            },
        };
    }

    const rendered = renderThread({
        thread,
        labelNames: options.labelNames,
        accountEmail: options.accountEmail,
    });
    if (rendered.messages.length === 0) {
        return {
            kind: "skipped",
            value: { sourceId: discovered.threadId, reason: "empty", detail: "drafts only" },
        };
    }

    const bytes = Buffer.byteLength(rendered.markdown, "utf8");
    if (bytes > maxItemBytes) {
        return {
            kind: "skipped",
            value: {
                sourceId: discovered.threadId,
                reason: "too-large",
                detail: `${bytes} bytes exceeds the ${maxItemBytes}-byte cap`,
            },
        };
    }

    const metadata: GmailThreadItemMetadata = {
        gmailThreadId: thread.id,
        gmailLink: gmailThreadLink(thread.id, options.accountEmail),
        subject: rendered.subject,
        messageCount: rendered.messages.length,
        participants: rendered.participants,
        firstMessageAt: rendered.firstMessageAt,
        lastMessageAt: rendered.lastMessageAt,
        labels: rendered.labels,
        matchedSelectors: discovered.matchedSelectors,
        attachmentCount: rendered.attachments.length,
        extension: ".md",
    };

    const value: KnowledgeItem = {
        sourceId: threadSourceId(thread.id),
        connectorId: GMAIL_CONNECTOR_ID,
        title: rendered.subject,
        kind: "gmail-thread",
        mimeType: "text/markdown",
        bytes,
        modifiedAt: rendered.lastMessageAt ?? "",
        location: {
            origin: metadata.gmailLink,
            relativePath: `${thread.id}.md`,
        },
        metadata: { ...metadata },
        content: rendered.markdown,
        contentHash: threadFingerprint(rendered.messages.map(message => message.id)),
    };

    return { kind: "item", value, rendered, thread };
}

export type CollectAttachmentOutcome =
    | { readonly kind: "item"; readonly value: KnowledgeItem }
    | { readonly kind: "skipped"; readonly value: SkippedKnowledgeItem }
    | { readonly kind: "not-found"; readonly sourceId: string };

export async function collectGmailAttachment(
    client: GmailClient,
    discovered: DiscoveredKnowledgeItem,
    ref: GmailAttachmentRef,
    policy: AttachmentPolicy = {}
): Promise<CollectAttachmentOutcome> {
    const exclusion = attachmentExclusion(ref, policy);
    if (exclusion) {
        return {
            kind: "skipped",
            value: {
                sourceId: discovered.sourceId,
                reason: exclusion.startsWith("unsupported") ? "excluded" : "too-large",
                detail: exclusion,
            },
        };
    }

    let content: Uint8Array;
    try {
        if (ref.inlineData) {
            content = decodeBase64UrlBytes(ref.inlineData);
        } else if (ref.attachmentId) {
            const body = await client.getAttachment(ref.messageId, ref.attachmentId);
            content = body.data ? decodeBase64UrlBytes(body.data) : new Uint8Array(0);
        } else {
            content = new Uint8Array(0);
        }
    } catch (error) {
        if (error instanceof GmailNotFoundError) {
            return { kind: "not-found", sourceId: discovered.sourceId };
        }
        return {
            kind: "skipped",
            value: { sourceId: discovered.sourceId, reason: "unreadable", detail: describeError(error) },
        };
    }

    if (content.byteLength === 0) {
        return { kind: "skipped", value: { sourceId: discovered.sourceId, reason: "empty" } };
    }
    const maxBytes = policy.maxBytes ?? DEFAULT_MAX_ITEM_BYTES;
    if (content.byteLength > maxBytes) {
        return {
            kind: "skipped",
            value: {
                sourceId: discovered.sourceId,
                reason: "too-large",
                detail: `download produced ${content.byteLength} bytes`,
            },
        };
    }

    return {
        kind: "item",
        value: {
            ...discovered,
            bytes: content.byteLength,
            content,
            contentHash: attachmentFingerprint(ref),
        },
    };
}
