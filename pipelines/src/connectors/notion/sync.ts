/**
 * One Notion sync run: search → fingerprint-compare → fetch Markdown →
 * render → store. Cost is proportional to change:
 *
 * - Discovery is the search listing alone (100 pages per call, metadata
 *   only), so an idle workspace of 1,000 pages costs ten calls.
 * - A page whose `last_edited_time` matches what the host stored is skipped
 *   without fetching its content.
 * - Every run is a full listing, so every run can say what is gone: a page
 *   that was deleted, trashed or un-shared stops appearing in search.
 *
 * The connector never touches the database: the host's `KnowledgeSink` owns
 * storage, and `knownSourceIds` (what the host already ingested) is how
 * deletions are noticed.
 */

import type {
    DiscoveredKnowledgeItem,
    FailedKnowledgeItem,
    KnowledgeSink,
    KnowledgeSyncReport,
    SkippedKnowledgeItem,
    StoredKnowledgeItem,
} from "../types";
import { NotionNotFoundError, type NotionClient, type NotionPage } from "./client";
import {
    isDatabaseRow,
    mergeUnknownSubtrees,
    pageFingerprint,
    pageTitle,
    renderPage,
} from "./render";

export const NOTION_CONNECTOR_ID = "notion";

/** Pages per run; beyond this the run is truncated and cannot report deletions. */
export const DEFAULT_MAX_PAGES = 2000;
/** A rendered page larger than this is skipped rather than ingested. */
export const DEFAULT_MAX_ITEM_BYTES = 2 * 1024 * 1024;
/** Extra calls per page to fill in subtrees a long page left out. */
export const DEFAULT_MAX_SUBTREE_FETCHES = 10;
/** Notion averages three requests a second per connection. */
export const DEFAULT_SYNC_CONCURRENCY = 3;

export interface NotionSyncOptions {
    readonly client: NotionClient;
    readonly sink: KnowledgeSink;
    /** Source ids (page ids) the host has already ingested for this connection. */
    readonly knownSourceIds?: readonly string[];
    readonly force?: boolean;
    readonly workspaceName?: string | null;
    readonly maxPages?: number;
    readonly maxItemBytes?: number;
    readonly maxSubtreeFetches?: number;
    readonly concurrency?: number;
    /** Clock seam for deterministic tests. */
    readonly now?: () => Date;
}

export interface NotionSyncResult extends KnowledgeSyncReport {
    /** Previously-ingested page ids that no longer appear; only set by a complete listing. */
    readonly missingSourceIds: readonly string[];
    /** Pages that answered 404 mid-run — deleted or un-shared since the listing. */
    readonly notFound: readonly string[];
    /** The listing stopped at `maxPages` (or Notion cut it short). */
    readonly truncated: boolean;
}

export function describeError(error: unknown): string {
    if (error instanceof Error) return `${error.name}: ${error.message}`;
    return typeof error === "string" ? error : "Unknown error";
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

function isPage(result: { readonly object: string }): result is NotionPage {
    return result.object === "page";
}

function isGone(page: NotionPage): boolean {
    return page.in_trash === true || page.archived === true || page.is_archived === true;
}

interface PageListing {
    readonly pages: NotionPage[];
    readonly truncated: boolean;
}

/** Every live page the connection can read, newest first, up to `maxPages`. */
async function listPages(client: NotionClient, maxPages: number): Promise<PageListing> {
    const pages: NotionPage[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    while (true) {
        const result = await client.searchPages({ startCursor: cursor, pageSize: 100 });
        for (const entry of result.results) {
            if (!isPage(entry) || isGone(entry) || seen.has(entry.id)) continue;
            seen.add(entry.id);
            pages.push(entry);
            if (pages.length >= maxPages) return { pages, truncated: true };
        }
        if (result.request_status?.type === "incomplete") return { pages, truncated: true };
        if (!result.has_more || !result.next_cursor) return { pages, truncated: false };
        cursor = result.next_cursor;
    }
}

export function toDiscoveredItem(page: NotionPage): DiscoveredKnowledgeItem {
    const title = pageTitle(page);
    return {
        sourceId: page.id,
        connectorId: NOTION_CONNECTOR_ID,
        title,
        kind: isDatabaseRow(page) ? "notion-database-row" : "notion-page",
        mimeType: "text/markdown",
        bytes: 0,
        modifiedAt: page.last_edited_time,
        location: { origin: page.url ?? `notion:${page.id}`, relativePath: title },
        metadata: {
            extension: ".md",
            notionPageId: page.id,
            notionUrl: page.url ?? null,
            notionParentType: page.parent?.type ?? null,
            notionParentId:
                page.parent?.page_id ??
                page.parent?.data_source_id ??
                page.parent?.database_id ??
                page.parent?.block_id ??
                null,
            createdAt: page.created_time ?? null,
            lastEditedAt: page.last_edited_time,
        },
    };
}

/** The page body, with any subtrees a long page left out filled back in. */
async function fetchBody(
    client: NotionClient,
    pageId: string,
    maxSubtreeFetches: number
): Promise<string> {
    const page = await client.getPageMarkdown(pageId);
    const unknown = page.unknown_block_ids ?? [];
    if (!page.truncated || unknown.length === 0) return page.markdown;

    const subtrees = new Map<string, string>();
    for (const blockId of unknown.slice(0, maxSubtreeFetches)) {
        try {
            const subtree = await client.getPageMarkdown(blockId);
            subtrees.set(blockId, subtree.markdown);
        } catch (error) {
            // Not shared with the connection: Notion lists it but won't serve it.
            if (error instanceof NotionNotFoundError) continue;
            throw error;
        }
    }
    return mergeUnknownSubtrees(page.markdown, subtrees);
}

interface PageOutcome {
    readonly stored?: StoredKnowledgeItem;
    readonly skipped?: SkippedKnowledgeItem;
    readonly failed?: FailedKnowledgeItem;
    readonly notFound?: string;
}

interface ProcessContext {
    readonly client: NotionClient;
    readonly sink: KnowledgeSink;
    readonly force: boolean;
    readonly workspaceName: string | null;
    readonly maxItemBytes: number;
    readonly maxSubtreeFetches: number;
}

async function processPage(context: ProcessContext, page: NotionPage): Promise<PageOutcome> {
    const discovered = toDiscoveredItem(page);
    const fingerprint = pageFingerprint(page);
    try {
        if (!context.force && context.sink.lastSyncedHash) {
            const previous = await context.sink.lastSyncedHash(discovered);
            if (previous === fingerprint) {
                return { skipped: { sourceId: page.id, reason: "unchanged" } };
            }
        }

        let body: string;
        try {
            body = await fetchBody(context.client, page.id, context.maxSubtreeFetches);
        } catch (error) {
            if (error instanceof NotionNotFoundError) return { notFound: page.id };
            throw error;
        }

        const content = renderPage(page, body, { workspaceName: context.workspaceName });
        const bytes = Buffer.byteLength(content, "utf-8");
        if (bytes > context.maxItemBytes) {
            return {
                skipped: {
                    sourceId: page.id,
                    reason: "too-large",
                    detail: `${bytes} bytes rendered; the limit is ${context.maxItemBytes}`,
                },
            };
        }

        const stored = await context.sink.store({
            ...discovered,
            bytes,
            content,
            contentHash: fingerprint,
        });
        return { stored };
    } catch (error) {
        return { failed: { sourceId: page.id, error: describeError(error) } };
    }
}

export async function syncNotion(options: NotionSyncOptions): Promise<NotionSyncResult> {
    const clock = options.now ?? (() => new Date());
    const startedAt = clock();

    const listing = await listPages(options.client, options.maxPages ?? DEFAULT_MAX_PAGES);

    const context: ProcessContext = {
        client: options.client,
        sink: options.sink,
        force: options.force ?? false,
        workspaceName: options.workspaceName ?? null,
        maxItemBytes: options.maxItemBytes ?? DEFAULT_MAX_ITEM_BYTES,
        maxSubtreeFetches: options.maxSubtreeFetches ?? DEFAULT_MAX_SUBTREE_FETCHES,
    };
    const outcomes = await runWithConcurrency(
        listing.pages.map(page => () => processPage(context, page)),
        options.concurrency ?? DEFAULT_SYNC_CONCURRENCY
    );

    const stored: StoredKnowledgeItem[] = [];
    const skipped: SkippedKnowledgeItem[] = [];
    const failed: FailedKnowledgeItem[] = [];
    const notFound: string[] = [];
    for (const outcome of outcomes) {
        if (outcome.stored) stored.push(outcome.stored);
        if (outcome.skipped) skipped.push(outcome.skipped);
        if (outcome.failed) failed.push(outcome.failed);
        if (outcome.notFound) notFound.push(outcome.notFound);
    }

    // Only a complete listing can say what is gone. A page that 404'd
    // mid-run is gone too: it was listed, but can no longer be read.
    let missingSourceIds: string[] = [];
    if (!listing.truncated) {
        const listed = new Set(listing.pages.map(page => page.id));
        missingSourceIds = (options.knownSourceIds ?? []).filter(id => !listed.has(id));
    }
    missingSourceIds = [...new Set([...missingSourceIds, ...notFound])];

    const finishedAt = clock();
    return {
        connectorId: NOTION_CONNECTOR_ID,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        discovered: listing.pages.length,
        stored,
        skipped,
        failed,
        missingSourceIds,
        notFound,
        truncated: listing.truncated,
    };
}
