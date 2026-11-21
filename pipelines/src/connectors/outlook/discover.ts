/**
 * Selectors → conversation references, without fetching a single body.
 *
 * A selector is a mail folder (by id) or a search query; the person chose
 * them, and they are the entire universe the sync touches. Folders are read
 * through their delta feed, which is both the listing and the cursor: from
 * scratch it names every message in the folder and ends in a delta link;
 * from a stored link it names only what changed since. Queries have no
 * cursor and are listed again every run.
 *
 * Listings name messages; the unit of knowledge is the conversation, so
 * references are grouped by `conversationId` as they arrive.
 */

import type { SkippedKnowledgeItem } from "../types";
import {
    OutlookApiError,
    OutlookAuthError,
    OutlookDeltaExpiredError,
    OutlookNotFoundError,
    type OutlookClient,
    type OutlookMailFolder,
    type OutlookMessageRef,
} from "./client";

export const OUTLOOK_CONNECTOR_ID = "outlook";

export const DEFAULT_MAX_CONVERSATIONS = 1000;

export interface OutlookScopeSelector {
    readonly kind: "folder" | "query";
    /** Mail folder id (or a well-known name such as `inbox`), or the search query. */
    readonly value: string;
    /** Display name; falls back to the value. */
    readonly name?: string;
}

export interface OutlookDiscoveredConversation {
    readonly conversationId: string;
    /** Names of the selectors that listed it. */
    readonly matchedSelectors: readonly string[];
    /**
     * True when a folder listing says it needs looking at: its delta feed
     * named it, or the folder was walked whole. False for a conversation only
     * a query listed — queries cannot say what changed.
     */
    readonly changed: boolean;
}

export interface OutlookDiscovery {
    readonly conversations: readonly OutlookDiscoveredConversation[];
    readonly skipped: readonly SkippedKnowledgeItem[];
    readonly truncated: boolean;
    /** Folder id → the link the next run starts from. */
    readonly nextDeltaLinks: Readonly<Record<string, string>>;
    /** A stored link was too old; that folder was walked from scratch. */
    readonly deltaExpired: boolean;
    /** True when no folder was read incrementally: the listing is everything the selectors match. */
    readonly fullRun: boolean;
    /** False when a selector failed or the cap cut the listing short. */
    readonly complete: boolean;
    /** Messages the delta feeds reported deleted or moved out of their folder. */
    readonly removedMessages: number;
    /** Conversations the delta feeds named; null on a full run. */
    readonly changedConversations: number | null;
}

export interface DiscoverOutlookOptions {
    readonly client: OutlookClient;
    readonly selectors: readonly OutlookScopeSelector[];
    /** Folder id → delta link from the previous run. */
    readonly deltaLinks?: Readonly<Record<string, string>>;
    /** Ignore stored links and walk every folder from scratch. */
    readonly force?: boolean;
    readonly maxConversations?: number;
}

export function selectorName(selector: OutlookScopeSelector): string {
    return selector.name ?? selector.value;
}

export function describeError(error: unknown): string {
    if (error instanceof Error) return `${error.name}: ${error.message}`;
    return String(error);
}

export interface OutlookFolderEntry extends OutlookMailFolder {
    /** Display names from the top of the mailbox down, e.g. `Clients/Acme`. */
    readonly path: string;
}

/**
 * The mailbox's folder tree, flattened — what a folder picker lists. Child
 * folders cost one call per parent, so the walk is bounded.
 */
export async function listOutlookFolderTree(
    client: OutlookClient,
    options: { readonly maxFolders?: number } = {}
): Promise<OutlookFolderEntry[]> {
    const maxFolders = options.maxFolders ?? 500;
    const entries: OutlookFolderEntry[] = [];

    async function visit(folders: readonly OutlookMailFolder[], prefix: string): Promise<void> {
        for (const folder of folders) {
            if (entries.length >= maxFolders) return;
            const path = prefix ? `${prefix}/${folder.displayName}` : folder.displayName;
            entries.push({ ...folder, path });
            if ((folder.childFolderCount ?? 0) > 0) {
                await visit(await client.listChildFolders(folder.id), path);
            }
        }
    }

    await visit(await client.listMailFolders(), "");
    return entries;
}

export async function discoverOutlookConversations(
    options: DiscoverOutlookOptions
): Promise<OutlookDiscovery> {
    const { client } = options;
    const maxConversations = options.maxConversations ?? DEFAULT_MAX_CONVERSATIONS;
    const storedLinks = options.deltaLinks ?? {};
    const force = options.force ?? false;

    const byId = new Map<string, { selectors: string[]; changed: boolean }>();
    const skipped: SkippedKnowledgeItem[] = [];
    const nextDeltaLinks: Record<string, string> = {};
    const deltaNamed = new Set<string>();
    let truncated = false;
    let deltaExpired = false;
    let incrementalFolders = 0;
    let failedSelectors = 0;
    let removedMessages = 0;

    /** Files a listed message under its conversation; false once the cap is hit. */
    function note(ref: OutlookMessageRef, name: string, changed: boolean): boolean {
        // A draft is not part of the conversation yet; if real messages sit
        // beside it they are listed in their own right.
        if (ref.isDraft || !ref.conversationId) return true;
        const existing = byId.get(ref.conversationId);
        if (existing) {
            if (!existing.selectors.includes(name)) existing.selectors.push(name);
            if (changed) existing.changed = true;
            return true;
        }
        if (byId.size >= maxConversations) {
            truncated = true;
            return false;
        }
        byId.set(ref.conversationId, { selectors: [name], changed });
        return true;
    }

    /**
     * One round of a folder's delta feed, from a stored link or from scratch.
     * Returns the new delta link, or null when the cap stopped it early.
     */
    async function readFolder(
        folderId: string,
        name: string,
        startLink: string | undefined
    ): Promise<string | null> {
        const incremental = startLink !== undefined;
        let link = startLink;
        while (true) {
            const page = await client.listFolderDelta({ folderId, link });
            for (const ref of page.value) {
                if (ref["@removed"]) {
                    // A removed entry carries no conversation id, so it
                    // cannot be traced to the document it belonged to.
                    if (incremental) removedMessages++;
                    continue;
                }
                if (!note(ref, name, true)) return null;
                if (incremental && !ref.isDraft && ref.conversationId) {
                    deltaNamed.add(ref.conversationId);
                }
            }
            if (page["@odata.deltaLink"]) return page["@odata.deltaLink"];
            link = page["@odata.nextLink"];
            if (!link) return null;
        }
    }

    async function listFolder(selector: OutlookScopeSelector, name: string): Promise<void> {
        const folderId = selector.value;
        const stored = force ? undefined : storedLinks[folderId];
        let deltaLink: string | null = null;
        let incremental = stored !== undefined;
        if (stored !== undefined) {
            try {
                deltaLink = await readFolder(folderId, name, stored);
            } catch (error) {
                if (!(error instanceof OutlookDeltaExpiredError)) throw error;
                deltaExpired = true;
                incremental = false;
            }
        }
        if (!incremental) deltaLink = await readFolder(folderId, name, undefined);
        if (incremental) incrementalFolders++;

        // A round the cap cut short has no new link; the old one (if any)
        // still stands, so nothing between it and now is lost.
        if (deltaLink) nextDeltaLinks[folderId] = deltaLink;
        else if (stored !== undefined && incremental) nextDeltaLinks[folderId] = stored;
    }

    async function listQuery(selector: OutlookScopeSelector, name: string): Promise<void> {
        let nextLink: string | undefined;
        do {
            const page = await client.searchMessages({ query: selector.value, nextLink });
            for (const ref of page.value) {
                if (!note(ref, name, false)) return;
            }
            nextLink = page["@odata.nextLink"];
        } while (nextLink);
    }

    for (const selector of options.selectors) {
        const name = selectorName(selector);
        try {
            if (selector.kind === "folder") await listFolder(selector, name);
            else await listQuery(selector, name);
        } catch (error) {
            // A dead grant fails every selector the same way; that is the
            // run's problem, not this selector's.
            if (error instanceof OutlookAuthError) throw error;
            // One bad selector (a deleted folder, a malformed query) must not
            // take the others down with it.
            failedSelectors++;
            const stored = storedLinks[selector.value];
            if (selector.kind === "folder" && stored !== undefined) {
                nextDeltaLinks[selector.value] = stored;
            }
            skipped.push({
                sourceId: `selector:${selector.kind}:${selector.value}`,
                reason:
                    error instanceof OutlookNotFoundError ||
                    (error instanceof OutlookApiError && error.status === 400)
                        ? "excluded"
                        : "unreadable",
                detail: describeError(error),
            });
        }
        if (truncated) break;
    }

    const fullRun = incrementalFolders === 0;
    const conversations: OutlookDiscoveredConversation[] = [];
    for (const [conversationId, entry] of byId) {
        conversations.push({
            conversationId,
            matchedSelectors: entry.selectors,
            changed: entry.changed,
        });
    }
    return {
        conversations,
        skipped,
        truncated,
        nextDeltaLinks,
        deltaExpired,
        fullRun,
        complete: failedSelectors === 0 && !truncated,
        removedMessages,
        changedConversations: fullRun ? null : deltaNamed.size,
    };
}
