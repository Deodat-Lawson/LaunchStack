/**
 * The merge: chat sessions (your own and those shared with you) plus
 * workspace pipeline runs, in one reverse-chronological feed.
 *
 * Loaders run concurrently and are *settled*, not awaited as a group — a
 * vertical whose table is mid-migration, or whose query throws, contributes
 * nothing and is logged. The sidebar showing five kinds instead of six is a
 * far better failure than a sidebar showing an error where the user's chats
 * should be.
 */

import {
    HISTORY_KINDS,
    isHistoryKind,
    type HistoryEntry,
    type HistoryKind,
} from "~/lib/workspace-history";
import { PIPELINE_LOADERS, type HistoryLoaderContext } from "~/server/history/loaders";
import type { SessionActor } from "~/server/sessions/access";
import { listChatFeed, type ChatFeedRow } from "~/server/sessions/feed";

export const DEFAULT_HISTORY_LIMIT = 60;
export const MAX_HISTORY_LIMIT = 200;

export interface LoadHistoryInput {
    companyId: bigint;
    /** Auth subject id — chat sessions are this person's; runs are the workspace's. */
    userId: string;
    /** Who is asking, for the chats shared with them (ADR-014). */
    actor: SessionActor;
    limit?: number;
    /** Restrict to these kinds. Omit for everything. */
    kinds?: readonly HistoryKind[];
    /** Only this person's archived chats. Runs have no archive, so none come back. */
    archived?: boolean;
}

export interface HistoryPage {
    entries: HistoryEntry[];
    /** Kinds whose loader failed this request, so the UI can say so honestly. */
    degraded: HistoryKind[];
    /** Chats this person has archived; null when not counted (the archived view, or no chats loaded). */
    archivedCount: number | null;
}

/** A chat as a history row. Kept here, not in the feed, so this module owns the wire shape. */
export function chatEntry(row: ChatFeedRow): HistoryEntry {
    return {
        id: `chat:${row.id}`,
        kind: "chat",
        refId: row.id,
        title: row.title,
        status: "done",
        at: row.lastMessageAt,
        href: `/employer/documents?session=${encodeURIComponent(row.id)}`,
        messageCount: row.messageCount,
        pinned: row.pinned,
        pinRank: row.pinRank,
        archived: row.archived,
        shared: row.shared,
        ...(row.mine ? {} : { sharedBy: row.ownerAuthUserId, unread: row.unread }),
    };
}

export async function loadWorkspaceHistory(input: LoadHistoryInput): Promise<HistoryPage> {
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_HISTORY_LIMIT, 1), MAX_HISTORY_LIMIT);
    const wanted = new Set<HistoryKind>(input.kinds ?? HISTORY_KINDS);

    const jobs: { kind: HistoryKind; run: () => Promise<HistoryEntry[]> }[] = [];
    const ctx: HistoryLoaderContext = { companyId: input.companyId, userId: input.userId, limit };
    let archivedCount: number | null = null;

    if (wanted.has("chat")) {
        jobs.push({
            kind: "chat",
            run: async () => {
                const feed = await listChatFeed(input.actor, { limit, archived: input.archived });
                archivedCount = feed.archivedCount;
                return feed.rows.map(chatEntry);
            },
        });
    }
    if (!input.archived) {
        for (const loader of PIPELINE_LOADERS) {
            if (wanted.has(loader.kind))
                jobs.push({ kind: loader.kind, run: () => loader.load(ctx) });
        }
    }

    const settled = await Promise.allSettled(jobs.map(job => job.run()));

    const entries: HistoryEntry[] = [];
    const degraded: HistoryKind[] = [];
    settled.forEach((result, index) => {
        const kind = jobs[index]!.kind;
        if (result.status === "fulfilled") {
            entries.push(...result.value);
        } else {
            degraded.push(kind);
            console.error(`[history] loader "${kind}" failed:`, result.reason);
        }
    });

    const newestFirst = (a: HistoryEntry, b: HistoryEntry) => Date.parse(b.at) - Date.parse(a.at);
    entries.sort(newestFirst);
    // Pins are drawn on top whatever their age, so the cap never drops one.
    const pinned = entries.filter(entry => entry.pinned);
    const rest = entries.filter(entry => !entry.pinned).slice(0, limit);
    return { entries: [...pinned, ...rest].sort(newestFirst), degraded, archivedCount };
}

/** Parse a repeated or comma-separated `kind` query param; empty means "all". */
export function parseKindsParam(values: string[]): HistoryKind[] | undefined {
    const kinds = values
        .flatMap(value => value.split(","))
        .map(value => value.trim())
        .filter(isHistoryKind);
    return kinds.length > 0 ? [...new Set(kinds)] : undefined;
}

/**
 * Delete one history row, whichever vertical owns it.
 *
 * The rail knows a kind and a refId and nothing else — no vertical's table,
 * no vertical's endpoint — which is the same contract that lets it render a
 * new kind without a client change. Chat is not handled here: sessions are
 * personal rather than workspace-scoped and already have their own delete.
 *
 * Returns false when no row matched, so a caller cannot tell "already gone"
 * from "belongs to another workspace". Both are a 404 to the client.
 */
export async function deleteHistoryEntry(input: {
    companyId: bigint;
    userId: string;
    kind: HistoryKind;
    refId: string;
}): Promise<boolean> {
    const loader = PIPELINE_LOADERS.find(candidate => candidate.kind === input.kind);
    if (!loader?.remove) return false;
    return loader.remove({ companyId: input.companyId, userId: input.userId }, input.refId);
}
