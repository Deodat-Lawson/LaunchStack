/**
 * Selectors → thread references, without fetching a single message.
 *
 * A selector is a Gmail label (by id) or a search query; the person chose
 * them, and under gmail.readonly they are the entire universe the sync
 * touches. `threads.list` is cheap (one call per 500 threads), so discovery
 * always lists everything the selectors match and lets the sync decide, per
 * thread, whether anything needs fetching.
 */

import type { SkippedKnowledgeItem } from "../types";
import { GmailApiError, type GmailClient, type GmailThreadRef } from "./client";

export const GMAIL_CONNECTOR_ID = "gmail";

export const DEFAULT_MAX_THREADS = 1000;

export interface GmailScopeSelector {
    readonly kind: "label" | "query";
    /** Label id (`Label_12`, `INBOX`) or the search query. */
    readonly value: string;
    /** Display name; falls back to the value. */
    readonly name?: string;
}

export interface GmailDiscoveredThread {
    readonly threadId: string;
    readonly historyId: string | null;
    readonly snippet: string;
    /** Names of the selectors that listed it. */
    readonly matchedSelectors: readonly string[];
}

export interface GmailDiscovery {
    readonly threads: readonly GmailDiscoveredThread[];
    readonly skipped: readonly SkippedKnowledgeItem[];
    readonly truncated: boolean;
}

export interface DiscoverGmailOptions {
    readonly client: GmailClient;
    readonly selectors: readonly GmailScopeSelector[];
    readonly maxThreads?: number;
}

export function selectorName(selector: GmailScopeSelector): string {
    return selector.name ?? selector.value;
}

export function describeError(error: unknown): string {
    if (error instanceof Error) return `${error.name}: ${error.message}`;
    return String(error);
}

export async function discoverGmailThreads(options: DiscoverGmailOptions): Promise<GmailDiscovery> {
    const maxThreads = options.maxThreads ?? DEFAULT_MAX_THREADS;
    const byId = new Map<string, { ref: GmailThreadRef; selectors: string[] }>();
    const skipped: SkippedKnowledgeItem[] = [];
    let truncated = false;

    for (const selector of options.selectors) {
        const name = selectorName(selector);
        let pageToken: string | undefined;
        try {
            do {
                const page = await options.client.listThreads({
                    ...(selector.kind === "label"
                        ? { labelIds: [selector.value] }
                        : { q: selector.value }),
                    pageToken,
                });
                for (const ref of page.threads ?? []) {
                    const existing = byId.get(ref.id);
                    if (existing) {
                        existing.selectors.push(name);
                        continue;
                    }
                    if (byId.size >= maxThreads) {
                        truncated = true;
                        break;
                    }
                    byId.set(ref.id, { ref, selectors: [name] });
                }
                pageToken = truncated ? undefined : page.nextPageToken;
            } while (pageToken);
        } catch (error) {
            // One bad selector (a deleted label, a malformed query) must not
            // take the others down with it.
            skipped.push({
                sourceId: `selector:${selector.kind}:${selector.value}`,
                reason:
                    error instanceof GmailApiError && error.status === 400
                        ? "excluded"
                        : "unreadable",
                detail: describeError(error),
            });
        }
        if (truncated) break;
    }

    const threads: GmailDiscoveredThread[] = [];
    for (const { ref, selectors } of byId.values()) {
        threads.push({
            threadId: ref.id,
            historyId: ref.historyId ?? null,
            snippet: ref.snippet ?? "",
            matchedSelectors: selectors,
        });
    }
    return { threads, skipped, truncated };
}
