/**
 * Reading a chat — your own, or one shared with you (ADR-014 §4).
 *
 * The owner gets the transcript exactly as stored. A reader gets it live (not
 * a snapshot), but with every citation and pinned source outside their own
 * scope removed and counted, without the owner's queued drafts, and without
 * the imported-transcript context a continuation carries (it was cut from a
 * document the reader may not be able to open). Anyone else gets null, which
 * the route answers as 404.
 */

import type { WorkspaceContext } from "~/lib/require-workspace-context";

import { resolveSessionAccess, type SessionAccessLevel } from "./access";
import { sessionDetail, type SessionDetail } from "./repository";
import {
    filterMessagesForReader,
    sourceIdsIn,
    visibleSourceIds,
    type ReaderMessage,
} from "./visibility";

export interface SessionAccessView {
    level: SessionAccessLevel;
    /** Auth subject id of the owner — draw them with `usePeople`. */
    ownerAuthUserId: string;
    /** When the owner first shared it; null while private. */
    sharedAt: string | null;
}

export interface ReadableSessionDetail extends Omit<SessionDetail, "messages"> {
    messages: ReaderMessage[];
    access: SessionAccessView;
    /** Citations removed across the whole transcript; always 0 for the owner. */
    hiddenCitations: number;
}

/** The transcript filtered to what `ctx` may open. Used for readers and for forks. */
export async function transcriptFor(
    ctx: WorkspaceContext,
    detail: SessionDetail
): Promise<{ messages: ReaderMessage[]; contextSourceIds: string[]; hiddenCitations: number }> {
    const visible = await visibleSourceIds(
        ctx,
        sourceIdsIn(detail.messages, detail.contextSourceIds)
    );
    const { messages, hiddenCitations } = filterMessagesForReader(detail.messages, visible);
    return {
        messages,
        contextSourceIds: detail.contextSourceIds.filter(id => visible.has(id)),
        hiddenCitations,
    };
}

export async function readSession(
    ctx: WorkspaceContext,
    sessionId: string
): Promise<ReadableSessionDetail | null> {
    const access = await resolveSessionAccess(ctx, sessionId);
    if (!access) return null;
    const detail = await sessionDetail(access.session);
    const view: SessionAccessView = {
        level: access.level,
        ownerAuthUserId: access.session.userId,
        sharedAt: access.session.sharedAt ? access.session.sharedAt.toISOString() : null,
    };
    if (access.level === "owner") return { ...detail, access: view, hiddenCitations: 0 };

    const filtered = await transcriptFor(ctx, detail);
    return {
        ...detail,
        messages: filtered.messages,
        contextSourceIds: filtered.contextSourceIds,
        // The owner's queue is their unsent drafts; a reader never sees them.
        queuedMessages: [],
        queueRevision: 0,
        continuation: null,
        access: view,
        hiddenCitations: filtered.hiddenCitations,
    };
}
