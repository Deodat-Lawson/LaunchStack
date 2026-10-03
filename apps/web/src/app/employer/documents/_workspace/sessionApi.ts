import type { HistoryEntry, HistoryKind } from "~/lib/workspace-history";
import type { ChatQueueItem, ChatTurnMetadata } from "~/lib/chat-turns";

/**
 * The client's half of session persistence — every call the workspace makes to
 * keep a chat, reopen it, rename it, or drop it, in one place.
 *
 * Mirrors `sourceApi`: the components above this know about threads and
 * history rows, never about routes or JSON envelopes.
 */

export interface SessionMessagePayload {
    metadata?: ChatTurnMetadata;
    createdAt?: string;
    role: "user" | "assistant";
    text: string;
    refs?: string[];
    citations?: unknown[];
    attachments?: unknown[];
    tokens?: number | null;
    /** Agent handle that produced (assistant) or was addressed by (user) the turn. */
    agentKey?: string | null;
}

/** How the caller reaches a chat (ADR-014): their own, or shared with them to read. */
export interface SessionAccess {
    level: "owner" | "view";
    /** Auth subject id of the person who started it. */
    ownerAuthUserId: string;
    /** When the owner first shared it; null while private. */
    sharedAt: string | null;
}

export interface StoredSession {
    queuedMessages?: ChatQueueItem[];
    queueRevision?: number;
    id: string;
    title: string;
    messageCount: number;
    contextSourceIds: string[];
    /** The agent the chat is held with; null = the default assistant. */
    agentKey?: string | null;
    lastMessageAt: string;
    createdAt: string;
    continuation?: { title: string; context: string } | null;
    messages?: (SessionMessagePayload & {
        seq: number;
        createdAt: string;
        /** Citations removed because the reader can't open their source. */
        hiddenCitations?: number;
    })[];
    /** Present on a read (`fetchSession`); absent on the summaries writes return. */
    access?: SessionAccess;
    /** Citations removed across the transcript for this reader; 0 for the owner. */
    hiddenCitations?: number;
}

export interface HistoryPage {
    entries: HistoryEntry[];
    degraded: HistoryKind[];
    /** Chats this person has archived; null when the server didn't count them. */
    archivedCount?: number | null;
}

export interface SessionState {
    pinned: boolean;
    pinRank: number | null;
    archived: boolean;
    lastSeenAt: string | null;
}

async function readError(res: Response, fallback: string): Promise<Error> {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    return new Error(body.message ?? body.error ?? fallback);
}

export async function fetchHistory(
    options: { limit?: number; archived?: boolean } = {}
): Promise<HistoryPage> {
    const params = new URLSearchParams();
    if (options.limit) params.set("limit", String(options.limit));
    if (options.archived) params.set("archived", "1");
    const query = params.toString();
    const res = await fetch(`/api/workspace/history${query ? `?${query}` : ""}`);
    if (!res.ok) throw await readError(res, "Failed to load history");
    return (await res.json()) as HistoryPage;
}

export async function createSession(input: {
    messages: SessionMessagePayload[];
    title?: string;
    contextSourceIds?: string[];
    continuation?: { title: string; context: string } | null;
    agentKey?: string | null;
}): Promise<StoredSession> {
    const res = await fetch("/api/workspace/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
    });
    if (!res.ok) throw await readError(res, "Failed to save this chat");
    return ((await res.json()) as { session: StoredSession }).session;
}

export async function appendMessages(
    sessionId: string,
    input: {
        messages: SessionMessagePayload[];
        contextSourceIds?: string[];
        /** `undefined` leaves the chat's agent alone; `null` clears it. */
        agentKey?: string | null;
    }
): Promise<StoredSession> {
    const res = await fetch(`/api/workspace/sessions/${encodeURIComponent(sessionId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
    });
    if (!res.ok) throw await readError(res, "Failed to save this message");
    return ((await res.json()) as { session: StoredSession }).session;
}

/** Null when the session is gone — a stale link or a chat deleted elsewhere. */
export async function fetchSession(sessionId: string): Promise<StoredSession | null> {
    const res = await fetch(`/api/workspace/sessions/${encodeURIComponent(sessionId)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw await readError(res, "Failed to load this chat");
    return ((await res.json()) as { session: StoredSession }).session;
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
    const res = await fetch(`/api/workspace/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
    });
    if (!res.ok) throw await readError(res, "Failed to rename this chat");
}

/**
 * "Continue in a new chat": the server copies a chat you can read into a new
 * private chat of yours, citations filtered to what you can open (ADR-014).
 */
export async function forkSession(sessionId: string): Promise<{ id: string; title: string }> {
    const res = await fetch(`/api/workspace/sessions/${encodeURIComponent(sessionId)}/fork`, {
        method: "POST",
    });
    if (!res.ok) throw await readError(res, "Couldn't continue this chat");
    return (await res.json()) as { id: string; title: string };
}

/** Your own pin / archive / read state for one chat — yours or shared with you. */
export async function updateSessionState(
    sessionId: string,
    patch: { pinned?: boolean; archived?: boolean; seen?: true }
): Promise<SessionState> {
    const res = await fetch(`/api/workspace/sessions/${encodeURIComponent(sessionId)}/state`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
    });
    if (!res.ok) throw await readError(res, "Couldn't update this chat");
    return ((await res.json()) as { state: SessionState }).state;
}

/** Your pinned chats, top first. Returns the order the server stored. */
export async function orderPins(ids: readonly string[]): Promise<string[]> {
    const res = await fetch("/api/workspace/sessions/pins/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
    });
    if (!res.ok) throw await readError(res, "Couldn't reorder pinned chats");
    return ((await res.json()) as { ids: string[] }).ids;
}

export async function deleteSession(sessionId: string): Promise<void> {
    const res = await fetch(`/api/workspace/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
    });
    if (!res.ok) throw await readError(res, "Failed to delete this chat");
}

export async function truncateMessages(
    sessionId: string,
    keepCount: number,
    expectedCount: number
): Promise<void> {
    const res = await fetch(`/api/workspace/sessions/${encodeURIComponent(sessionId)}/messages`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keepCount, expectedCount }),
    });
    if (!res.ok) throw await readError(res, "Failed to rewind this chat");
}

export interface QueueState {
    items: ChatQueueItem[];
    revision: number;
    claimed?: ChatQueueItem;
    claimedMessage?: SessionMessagePayload;
    conflict?: boolean;
}
export async function updateQueue(
    sessionId: string,
    revision: number,
    items: ChatQueueItem[]
): Promise<QueueState> {
    const res = await fetch(`/api/workspace/sessions/${encodeURIComponent(sessionId)}/queue`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision, items }),
    });
    if (!res.ok && res.status !== 409) throw await readError(res, "Failed to save queued messages");
    return (await res.json()) as QueueState;
}
export async function claimQueuedMessage(
    sessionId: string,
    revision: number,
    id: string
): Promise<QueueState> {
    const res = await fetch(`/api/workspace/sessions/${encodeURIComponent(sessionId)}/queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision, id }),
    });
    if (!res.ok && res.status !== 409) throw await readError(res, "Failed to send queued message");
    return (await res.json()) as QueueState;
}
