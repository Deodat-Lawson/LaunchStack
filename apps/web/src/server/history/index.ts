/**
 * The merge: personal chat sessions plus workspace pipeline runs, in one
 * reverse-chronological feed.
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
import { listSessions } from "~/server/sessions/repository";

export const DEFAULT_HISTORY_LIMIT = 60;
export const MAX_HISTORY_LIMIT = 200;

export interface LoadHistoryInput {
    companyId: bigint;
    /** Auth subject id — chat sessions are this person's; runs are the workspace's. */
    userId: string;
    limit?: number;
    /** Restrict to these kinds. Omit for everything. */
    kinds?: readonly HistoryKind[];
}

export interface HistoryPage {
    entries: HistoryEntry[];
    /** Kinds whose loader failed this request, so the UI can say so honestly. */
    degraded: HistoryKind[];
}

/** Chat sessions as history rows. Kept here, not in the repository, so the
 * repository stays about storage and this module owns the wire shape. */
async function loadChatEntries(ctx: HistoryLoaderContext): Promise<HistoryEntry[]> {
    const sessions = await listSessions(
        { companyId: ctx.companyId, userId: ctx.userId },
        { limit: ctx.limit }
    );
    return sessions.map(session => ({
        id: `chat:${session.id}`,
        kind: "chat" as const,
        refId: session.id,
        title: session.title,
        status: "done" as const,
        at: session.lastMessageAt,
        href: `/employer/documents?session=${encodeURIComponent(session.id)}`,
        messageCount: session.messageCount,
    }));
}

export async function loadWorkspaceHistory(input: LoadHistoryInput): Promise<HistoryPage> {
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_HISTORY_LIMIT, 1), MAX_HISTORY_LIMIT);
    const wanted = new Set<HistoryKind>(input.kinds ?? HISTORY_KINDS);

    const jobs: { kind: HistoryKind; run: () => Promise<HistoryEntry[]> }[] = [];
    const ctx: HistoryLoaderContext = { companyId: input.companyId, userId: input.userId, limit };

    if (wanted.has("chat")) jobs.push({ kind: "chat", run: () => loadChatEntries(ctx) });
    for (const loader of PIPELINE_LOADERS) {
        if (wanted.has(loader.kind)) jobs.push({ kind: loader.kind, run: () => loader.load(ctx) });
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

    entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    return { entries: entries.slice(0, limit), degraded };
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
