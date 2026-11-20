/**
 * One Outlook sync run: delta → discover → fingerprint-compare → collect →
 * store. The cost is proportional to what changed:
 *
 * - An idle mailbox costs the profile and one empty delta page per folder.
 * - A folder with a stored delta link names only the conversations that
 *   changed, and only those are fetched.
 * - A conversation whose message set the sink already holds is confirmed
 *   from its messages alone and skipped — no attachments are listed.
 * - The first run, a forced run, or an expired delta link walks the whole
 *   folder (which is also what yields the next delta link).
 *
 * The connector never touches the database: the host's `KnowledgeSink` owns
 * storage, `deltaLinks` come from and go back to the host, and
 * `knownSourceIds` (what the host already ingested) is how deletions are
 * noticed.
 */

import type {
    FailedKnowledgeItem,
    KnowledgeSink,
    KnowledgeSyncReport,
    SkippedKnowledgeItem,
    StoredKnowledgeItem,
} from "../types";
import { OutlookNotFoundError, type OutlookClient, type OutlookMessage } from "./client";
import {
    attachmentFingerprint,
    collectOutlookAttachment,
    collectOutlookConversation,
    conversationIdOfSourceId,
    DEFAULT_MAX_ITEM_BYTES,
    INLINE_ATTACHMENT_DETAIL,
    attachmentSourceId,
    toAttachmentDiscoveredItem,
    toConversationDiscoveredItem,
    type AttachmentPolicy,
} from "./collect";
import {
    describeError,
    discoverOutlookConversations,
    OUTLOOK_CONNECTOR_ID,
    type OutlookDiscoveredConversation,
    type OutlookScopeSelector,
} from "./discover";
import {
    conversationFingerprint,
    conversationLink,
    conversationMessages,
    type OutlookFolderLabel,
} from "./render";

export const DEFAULT_SYNC_CONCURRENCY = 4;

export interface OutlookSyncOptions {
    readonly client: OutlookClient;
    readonly selectors: readonly OutlookScopeSelector[];
    readonly sink: KnowledgeSink;
    /** Folder id → delta link from the previous run; absent on the first run. */
    readonly deltaLinks?: Readonly<Record<string, string>>;
    /** Source ids the host has already ingested; absent ones are reported missing on full runs. */
    readonly knownSourceIds?: readonly string[];
    readonly force?: boolean;
    readonly includeAttachments?: boolean;
    readonly attachmentPolicy?: AttachmentPolicy;
    readonly maxItemBytes?: number;
    readonly maxConversations?: number;
    /** Parallel collect+store pipelines. Defaults to 4. */
    readonly concurrency?: number;
    /** Clock seam for deterministic tests. */
    readonly now?: () => Date;
}

export interface OutlookSyncResult extends KnowledgeSyncReport {
    /** False → the delta feeds were empty and nothing new matched; nothing was fetched. */
    readonly dirty: boolean;
    /** Persist after a successful run, replacing what was stored; next run starts here. */
    readonly nextDeltaLinks: Readonly<Record<string, string>>;
    /** A stored delta link was too old; that folder was walked from scratch. */
    readonly deltaExpired: boolean;
    /**
     * Full runs only: previously-ingested source ids the selectors no longer
     * match. Empty when the listing was truncated or a selector failed.
     */
    readonly missingSourceIds: readonly string[];
    /** Conversations and attachments answering 404 mid-run — deleted since discovery. */
    readonly notFound: readonly string[];
    readonly truncated: boolean;
    /** Conversations the delta feeds named; null on a full run. */
    readonly changedConversations: number | null;
    /**
     * Messages the delta feeds reported deleted or moved away. They cannot be
     * traced to a conversation, so an incremental run reports nothing
     * missing; a host that sees a non-zero count can follow with a `force`
     * run, which can.
     */
    readonly removedMessages: number;
    readonly accountEmail: string | null;
}

async function runWithConcurrency<T>(
    tasks: readonly (() => Promise<T>)[],
    limit: number
): Promise<T[]> {
    const results = new Array<T>(tasks.length);
    let cursor = 0;

    const workers = Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, async () => {
        while (true) {
            const index = cursor++;
            const task = tasks[index];
            if (!task) return;
            results[index] = await task();
        }
    });

    await Promise.all(workers);
    return results;
}

type ConversationOutcome = {
    readonly stored: StoredKnowledgeItem[];
    readonly skipped: SkippedKnowledgeItem[];
    readonly failed: FailedKnowledgeItem[];
    readonly notFound: string[];
};

interface ProcessContext {
    readonly client: OutlookClient;
    readonly sink: KnowledgeSink;
    readonly force: boolean;
    readonly folders: ReadonlyMap<string, OutlookFolderLabel>;
    readonly maxItemBytes: number;
    readonly includeAttachments: boolean;
    readonly attachmentPolicy: AttachmentPolicy;
}

async function processConversation(
    context: ProcessContext,
    discovered: OutlookDiscoveredConversation
): Promise<ConversationOutcome> {
    const outcome: ConversationOutcome = { stored: [], skipped: [], failed: [], notFound: [] };
    const { conversationId } = discovered;

    try {
        let messages: readonly OutlookMessage[];
        try {
            messages = await context.client.listConversationMessages(conversationId);
        } catch (error) {
            if (error instanceof OutlookNotFoundError) {
                outcome.notFound.push(conversationId);
                return outcome;
            }
            throw error;
        }

        // The message set is the conversation's identity, so the unchanged
        // case stops here — before attachments are listed or anything is
        // rendered.
        const real = conversationMessages(messages);
        if (real.length > 0 && !context.force && context.sink.lastSyncedHash) {
            const previous = await context.sink.lastSyncedHash(
                toConversationDiscoveredItem(discovered, conversationLink(real))
            );
            if (previous === conversationFingerprint(real.map(message => message.id))) {
                outcome.skipped.push({ sourceId: conversationId, reason: "unchanged" });
                return outcome;
            }
        }

        const collected = await collectOutlookConversation(context.client, discovered, {
            folders: context.folders,
            maxItemBytes: context.maxItemBytes,
            includeAttachments: context.includeAttachments,
            messages,
        });
        if (collected.kind === "skipped") {
            outcome.skipped.push(collected.value);
            return outcome;
        }
        if (collected.kind === "not-found") {
            outcome.notFound.push(collected.conversationId);
            return outcome;
        }

        outcome.stored.push(await context.sink.store(collected.value));

        if (!context.includeAttachments) return outcome;
        // Embedded images are named so the report accounts for them, and
        // never fetched.
        for (const ref of collected.rendered.inlineAttachments) {
            outcome.skipped.push({
                sourceId: attachmentSourceId(conversationId, ref),
                reason: "excluded",
                detail: INLINE_ATTACHMENT_DETAIL,
            });
        }
        for (const ref of collected.rendered.attachments) {
            const item = toAttachmentDiscoveredItem(conversationId, ref, collected.rendered);
            try {
                if (!context.force && context.sink.lastSyncedHash) {
                    const previous = await context.sink.lastSyncedHash(item);
                    if (previous === attachmentFingerprint(ref)) {
                        outcome.skipped.push({ sourceId: item.sourceId, reason: "unchanged" });
                        continue;
                    }
                }
                const attachment = await collectOutlookAttachment(
                    context.client,
                    item,
                    ref,
                    context.attachmentPolicy
                );
                if (attachment.kind === "skipped") outcome.skipped.push(attachment.value);
                else if (attachment.kind === "not-found")
                    outcome.notFound.push(attachment.sourceId);
                else outcome.stored.push(await context.sink.store(attachment.value));
            } catch (error) {
                outcome.failed.push({ sourceId: item.sourceId, error: describeError(error) });
            }
        }
    } catch (error) {
        outcome.failed.push({ sourceId: conversationId, error: describeError(error) });
    }
    return outcome;
}

export async function syncOutlook(options: OutlookSyncOptions): Promise<OutlookSyncResult> {
    const { client, sink } = options;
    const clock = options.now ?? (() => new Date());
    const startedAt = clock();
    const force = options.force ?? false;
    const known = new Set(options.knownSourceIds ?? []);
    const knownConversationIds = new Set([...known].map(conversationIdOfSourceId));

    const profile = await client.getProfile();
    const accountEmail = profile.mail ?? profile.userPrincipalName ?? null;

    // Each folder's next delta link comes out of its own listing, so changes
    // that land mid-sync fall after it and surface next run instead of being
    // lost.
    const discovery = await discoverOutlookConversations({
        client,
        selectors: options.selectors,
        deltaLinks: options.deltaLinks,
        force,
        maxConversations: options.maxConversations,
    });

    // Incremental runs touch the conversations the delta feeds named plus
    // any a query newly matches (a query has no feed to say what changed).
    const candidates = discovery.fullRun
        ? discovery.conversations
        : discovery.conversations.filter(
              conversation =>
                  conversation.changed || !knownConversationIds.has(conversation.conversationId)
          );

    const stored: StoredKnowledgeItem[] = [];
    const skipped: SkippedKnowledgeItem[] = [...discovery.skipped];
    const failed: FailedKnowledgeItem[] = [];
    const notFound: string[] = [];

    if (candidates.length > 0) {
        const folders = new Map<string, OutlookFolderLabel>();
        for (const folder of await client.listMailFolders()) folders.set(folder.id, folder);
        // A picked subfolder is not in the top-level listing; its selector
        // knows what it is called.
        for (const selector of options.selectors) {
            if (selector.kind === "folder" && selector.name && !folders.has(selector.value)) {
                folders.set(selector.value, { displayName: selector.name });
            }
        }

        const context: ProcessContext = {
            client,
            sink,
            force,
            folders,
            maxItemBytes: options.maxItemBytes ?? DEFAULT_MAX_ITEM_BYTES,
            includeAttachments: options.includeAttachments ?? true,
            attachmentPolicy: options.attachmentPolicy ?? {},
        };

        const outcomes = await runWithConcurrency(
            candidates.map(conversation => () => processConversation(context, conversation)),
            options.concurrency ?? DEFAULT_SYNC_CONCURRENCY
        );
        for (const outcome of outcomes) {
            stored.push(...outcome.stored);
            skipped.push(...outcome.skipped);
            failed.push(...outcome.failed);
            notFound.push(...outcome.notFound);
        }
    }

    // Only a complete walk can say what is gone; an incremental run saw a
    // slice. A truncated walk cannot say either, nor one where a selector
    // failed to list.
    let missingSourceIds: string[] = [];
    if (discovery.fullRun && discovery.complete) {
        const discoveredIds = new Set(
            discovery.conversations.map(conversation => conversation.conversationId)
        );
        const gone = new Set(notFound.map(conversationIdOfSourceId));
        missingSourceIds = [...known].filter(id => {
            const conversationId = conversationIdOfSourceId(id);
            return !discoveredIds.has(conversationId) && !gone.has(conversationId);
        });
    }

    const finishedAt = clock();
    return {
        connectorId: OUTLOOK_CONNECTOR_ID,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        dirty: discovery.fullRun || candidates.length > 0 || discovery.removedMessages > 0,
        nextDeltaLinks: discovery.nextDeltaLinks,
        deltaExpired: discovery.deltaExpired,
        discovered: candidates.length,
        stored,
        skipped,
        failed,
        missingSourceIds,
        notFound,
        truncated: discovery.truncated,
        changedConversations: discovery.changedConversations,
        removedMessages: discovery.removedMessages,
        accountEmail,
    };
}
