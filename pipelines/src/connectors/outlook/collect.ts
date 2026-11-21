/**
 * Conversation reference → `KnowledgeItem`s with real content: the rendered
 * conversation as Markdown, and each ingestible attachment as its own item.
 * Size caps and unsupported formats become skips with reasons — one oversized
 * PDF must not abort a mailbox sync.
 */

import {
    DEFAULT_ATTACHMENT_MIME_ALLOWLIST,
    DEFAULT_MAX_ITEM_BYTES,
    type AttachmentPolicy,
} from "../gmail/collect";
import { safeFilename } from "../gmail/render";
import type { DiscoveredKnowledgeItem, KnowledgeItem, SkippedKnowledgeItem } from "../types";
import { OutlookNotFoundError, type OutlookClient, type OutlookMessage } from "./client";
import {
    describeError,
    OUTLOOK_CONNECTOR_ID,
    type OutlookDiscoveredConversation,
} from "./discover";
import {
    conversationFingerprint,
    renderConversation,
    toAttachmentRef,
    type OutlookAttachmentRef,
    type OutlookFolderLabel,
    type RenderedConversation,
} from "./render";

// The same ceiling and the same formats as Gmail attachments: what the
// ingestion router can turn into text, images deliberately out.
export { DEFAULT_ATTACHMENT_MIME_ALLOWLIST, DEFAULT_MAX_ITEM_BYTES, type AttachmentPolicy };

/** The `detail` of the skip an embedded image gets. */
export const INLINE_ATTACHMENT_DETAIL = "inline attachment";

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

export interface OutlookConversationItemMetadata {
    readonly outlookConversationId: string;
    /** The newest message's `webLink`; null when Graph sent none. */
    readonly outlookLink: string | null;
    readonly subject: string;
    readonly messageCount: number;
    readonly participants: readonly string[];
    readonly firstMessageAt: string | null;
    readonly lastMessageAt: string | null;
    readonly folders: readonly string[];
    readonly matchedSelectors: readonly string[];
    readonly attachmentCount: number;
    readonly extension: string;
}

export function conversationSourceId(conversationId: string): string {
    return conversationId;
}

export function attachmentSourceId(conversationId: string, ref: OutlookAttachmentRef): string {
    return `${conversationId}:${ref.messageId}:${ref.attachmentId}`;
}

/** The conversation an item's source id belongs to (attachments are `conversation:message:attachment`). */
export function conversationIdOfSourceId(sourceId: string): string {
    const colon = sourceId.indexOf(":");
    return colon === -1 ? sourceId : sourceId.slice(0, colon);
}

/** Messages never change, so an attachment's identity is its address. */
export function attachmentFingerprint(ref: OutlookAttachmentRef): string {
    return `att:${ref.messageId}:${ref.attachmentId}`;
}

function attachmentExtension(ref: OutlookAttachmentRef): string | null {
    const dot = ref.filename.lastIndexOf(".");
    const fromName = dot > 0 ? ref.filename.slice(dot).toLowerCase() : null;
    if (fromName && MIME_BY_EXTENSION[fromName]) return fromName;
    return EXTENSION_BY_MIME[ref.mimeType] ?? null;
}

/** Why an attachment will not be ingested, or null when it will. */
export function attachmentExclusion(
    ref: OutlookAttachmentRef,
    policy: AttachmentPolicy
): string | null {
    if (ref.isInline) return INLINE_ATTACHMENT_DETAIL;
    const allow = policy.mimeAllowlist ?? DEFAULT_ATTACHMENT_MIME_ALLOWLIST;
    const extension = attachmentExtension(ref);
    const mime = extension ? (MIME_BY_EXTENSION[extension] ?? ref.mimeType) : ref.mimeType;
    if (!allow.includes(mime)) return `unsupported attachment type ${ref.mimeType}`;
    const maxBytes = policy.maxBytes ?? DEFAULT_MAX_ITEM_BYTES;
    if (ref.size > maxBytes) return `${ref.size} bytes exceeds the ${maxBytes}-byte cap`;
    return null;
}

/** The conversation as the sink knows it — enough for `lastSyncedHash`, before anything is read. */
export function toConversationDiscoveredItem(
    discovered: OutlookDiscoveredConversation,
    link: string | null = null
): DiscoveredKnowledgeItem {
    return {
        sourceId: conversationSourceId(discovered.conversationId),
        connectorId: OUTLOOK_CONNECTOR_ID,
        title: discovered.conversationId,
        kind: "outlook-conversation",
        mimeType: "text/markdown",
        bytes: 0,
        modifiedAt: "",
        location: {
            origin: link ?? discovered.conversationId,
            relativePath: `${discovered.conversationId}.md`,
        },
        metadata: { outlookConversationId: discovered.conversationId, extension: ".md" },
    };
}

export function toAttachmentDiscoveredItem(
    conversationId: string,
    ref: OutlookAttachmentRef,
    rendered: Pick<RenderedConversation, "subject" | "lastMessageAt" | "link">
): DiscoveredKnowledgeItem {
    const extension = attachmentExtension(ref) ?? "";
    const base = safeFilename(ref.filename);
    const title =
        extension && !base.toLowerCase().endsWith(extension) ? `${base}${extension}` : base;
    return {
        sourceId: attachmentSourceId(conversationId, ref),
        connectorId: OUTLOOK_CONNECTOR_ID,
        title,
        kind: "outlook-attachment",
        mimeType: MIME_BY_EXTENSION[extension] ?? ref.mimeType,
        bytes: ref.size,
        modifiedAt: rendered.lastMessageAt ?? "",
        location: {
            origin: rendered.link ?? conversationId,
            relativePath: `${conversationId}/${title}`,
        },
        metadata: {
            outlookConversationId: conversationId,
            outlookMessageId: ref.messageId,
            outlookAttachmentId: ref.attachmentId,
            outlookLink: rendered.link,
            subject: rendered.subject,
            originalFilename: ref.filename,
            extension,
        },
    };
}

export type CollectConversationOutcome =
    | {
          readonly kind: "item";
          readonly value: KnowledgeItem;
          readonly rendered: RenderedConversation;
      }
    | { readonly kind: "skipped"; readonly value: SkippedKnowledgeItem }
    | { readonly kind: "not-found"; readonly conversationId: string };

export interface CollectConversationOptions {
    /** Folder id → name, for the document header. */
    readonly folders?: ReadonlyMap<string, OutlookFolderLabel>;
    readonly maxItemBytes?: number;
    /** List each message's attachments (one call per message that has any). Defaults to true. */
    readonly includeAttachments?: boolean;
    /** Already-fetched messages (the sync fetches them for the fingerprint check). */
    readonly messages?: readonly OutlookMessage[];
}

export async function collectOutlookConversation(
    client: OutlookClient,
    discovered: OutlookDiscoveredConversation,
    options: CollectConversationOptions = {}
): Promise<CollectConversationOutcome> {
    const { conversationId } = discovered;
    const maxItemBytes = options.maxItemBytes ?? DEFAULT_MAX_ITEM_BYTES;

    let messages: readonly OutlookMessage[];
    const attachments = new Map<string, OutlookAttachmentRef[]>();
    try {
        messages = options.messages ?? (await client.listConversationMessages(conversationId));
        if (options.includeAttachments ?? true) {
            for (const message of messages) {
                if (message.isDraft || !message.hasAttachments) continue;
                const listed = await client.listAttachments(message.id);
                attachments.set(
                    message.id,
                    listed.map(attachment => toAttachmentRef(message.id, attachment))
                );
            }
        }
    } catch (error) {
        if (error instanceof OutlookNotFoundError) return { kind: "not-found", conversationId };
        return {
            kind: "skipped",
            value: { sourceId: conversationId, reason: "unreadable", detail: describeError(error) },
        };
    }
    // A conversation with no messages left at all was deleted since it was listed.
    if (messages.length === 0) return { kind: "not-found", conversationId };

    const rendered = renderConversation({
        conversationId,
        messages,
        attachments,
        folders: options.folders,
    });
    if (rendered.messages.length === 0) {
        return {
            kind: "skipped",
            value: { sourceId: conversationId, reason: "empty", detail: "drafts only" },
        };
    }

    const bytes = Buffer.byteLength(rendered.markdown, "utf8");
    if (bytes > maxItemBytes) {
        return {
            kind: "skipped",
            value: {
                sourceId: conversationId,
                reason: "too-large",
                detail: `${bytes} bytes exceeds the ${maxItemBytes}-byte cap`,
            },
        };
    }

    const metadata: OutlookConversationItemMetadata = {
        outlookConversationId: conversationId,
        outlookLink: rendered.link,
        subject: rendered.subject,
        messageCount: rendered.messages.length,
        participants: rendered.participants,
        firstMessageAt: rendered.firstMessageAt,
        lastMessageAt: rendered.lastMessageAt,
        folders: rendered.folders,
        matchedSelectors: discovered.matchedSelectors,
        attachmentCount: rendered.attachments.length,
        extension: ".md",
    };

    const value: KnowledgeItem = {
        sourceId: conversationSourceId(conversationId),
        connectorId: OUTLOOK_CONNECTOR_ID,
        title: rendered.subject,
        kind: "outlook-conversation",
        mimeType: "text/markdown",
        bytes,
        modifiedAt: rendered.lastMessageAt ?? "",
        location: {
            origin: rendered.link ?? conversationId,
            relativePath: `${conversationId}.md`,
        },
        metadata: { ...metadata },
        content: rendered.markdown,
        contentHash: conversationFingerprint(rendered.messages.map(message => message.id)),
    };

    return { kind: "item", value, rendered };
}

export type CollectAttachmentOutcome =
    | { readonly kind: "item"; readonly value: KnowledgeItem }
    | { readonly kind: "skipped"; readonly value: SkippedKnowledgeItem }
    | { readonly kind: "not-found"; readonly sourceId: string };

export async function collectOutlookAttachment(
    client: OutlookClient,
    discovered: DiscoveredKnowledgeItem,
    ref: OutlookAttachmentRef,
    policy: AttachmentPolicy = {}
): Promise<CollectAttachmentOutcome> {
    const exclusion = attachmentExclusion(ref, policy);
    if (exclusion) {
        return {
            kind: "skipped",
            value: {
                sourceId: discovered.sourceId,
                reason: exclusion.includes("exceeds") ? "too-large" : "excluded",
                detail: exclusion,
            },
        };
    }

    let content: Uint8Array;
    try {
        content = await client.downloadAttachment(ref.messageId, ref.attachmentId);
    } catch (error) {
        if (error instanceof OutlookNotFoundError) {
            return { kind: "not-found", sourceId: discovered.sourceId };
        }
        return {
            kind: "skipped",
            value: {
                sourceId: discovered.sourceId,
                reason: "unreadable",
                detail: describeError(error),
            },
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
