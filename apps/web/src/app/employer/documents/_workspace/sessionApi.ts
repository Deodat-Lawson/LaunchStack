import type { useTranslations } from "next-intl";
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

/**
 * What each call says when the server gave no reason of its own. The English
 * is the error's message, for callers without a translator; a screen shows
 * `chat.sessionErrors.<key>` through `sessionErrorMessage`.
 */
const FALLBACKS = {
    loadHistory: "Failed to load history",
    saveChat: "Failed to save this chat",
    saveMessage: "Failed to save this message",
    loadChat: "Failed to load this chat",
    renameChat: "Failed to rename this chat",
    continueChat: "Couldn't continue this chat",
    updateChat: "Couldn't update this chat",
    reorderPins: "Couldn't reorder pinned chats",
    deleteChat: "Failed to delete this chat",
    rewindChat: "Failed to rewind this chat",
    saveQueue: "Failed to save queued messages",
    sendQueued: "Failed to send queued message",
} as const;

export type SessionErrorKey = keyof typeof FALLBACKS;

/** `useTranslations("chat.sessionErrors")`. */
export type SessionErrorTranslator = ReturnType<typeof useTranslations<"chat.sessionErrors">>;

/**
 * A failed session call. `fallbackKey` is set when the server said nothing
 * usable, so the message is this module's own words rather than the server's.
 */
export class SessionApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly fallbackKey: SessionErrorKey | null
    ) {
        super(message);
        this.name = "SessionApiError";
    }
}

/**
 * The fallback key a failed call carries, if it carries one. Read by shape
 * rather than `instanceof`, so callers keep working where this module is
 * replaced by a test double (copy it rather than import it there).
 */
export function sessionErrorKey(error: unknown): SessionErrorKey | null {
    const key = error instanceof Error ? (error as { fallbackKey?: unknown }).fallbackKey : null;
    return typeof key === "string" && Object.hasOwn(FALLBACKS, key)
        ? (key as SessionErrorKey)
        : null;
}

/**
 * The words to show for an error from this module: the server's reason
 * as given, this module's own fallback in the reader's language, or — for
 * anything else — the error's message, then `fallback`.
 */
export function sessionErrorMessage(
    error: unknown,
    t: SessionErrorTranslator,
    fallback?: string
): string {
    const key = sessionErrorKey(error);
    if (key) return t(key);
    if (error instanceof Error && error.message) return error.message;
    return fallback ?? "";
}

async function readError(res: Response, fallback: SessionErrorKey): Promise<SessionApiError> {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    const reason = body.message ?? body.error;
    return new SessionApiError(reason ?? FALLBACKS[fallback], res.status, reason ? null : fallback);
}

export async function fetchHistory(
    options: { limit?: number; archived?: boolean } = {}
): Promise<HistoryPage> {
    const params = new URLSearchParams();
    if (options.limit) params.set("limit", String(options.limit));
    if (options.archived) params.set("archived", "1");
    const query = params.toString();
    const res = await fetch(`/api/workspace/history${query ? `?${query}` : ""}`);
    if (!res.ok) throw await readError(res, "loadHistory");
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
    if (!res.ok) throw await readError(res, "saveChat");
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
    if (!res.ok) throw await readError(res, "saveMessage");
    return ((await res.json()) as { session: StoredSession }).session;
}

/** Null when the session is gone — a stale link or a chat deleted elsewhere. */
export async function fetchSession(sessionId: string): Promise<StoredSession | null> {
    const res = await fetch(`/api/workspace/sessions/${encodeURIComponent(sessionId)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw await readError(res, "loadChat");
    return ((await res.json()) as { session: StoredSession }).session;
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
    const res = await fetch(`/api/workspace/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
    });
    if (!res.ok) throw await readError(res, "renameChat");
}

/**
 * "Continue in a new chat": the server copies a chat you can read into a new
 * private chat of yours, citations filtered to what you can open (ADR-014).
 */
export async function forkSession(sessionId: string): Promise<{ id: string; title: string }> {
    const res = await fetch(`/api/workspace/sessions/${encodeURIComponent(sessionId)}/fork`, {
        method: "POST",
    });
    if (!res.ok) throw await readError(res, "continueChat");
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
    if (!res.ok) throw await readError(res, "updateChat");
    return ((await res.json()) as { state: SessionState }).state;
}

/** Your pinned chats, top first. Returns the order the server stored. */
export async function orderPins(ids: readonly string[]): Promise<string[]> {
    const res = await fetch("/api/workspace/sessions/pins/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
    });
    if (!res.ok) throw await readError(res, "reorderPins");
    return ((await res.json()) as { ids: string[] }).ids;
}

export async function deleteSession(sessionId: string): Promise<void> {
    const res = await fetch(`/api/workspace/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
    });
    if (!res.ok) throw await readError(res, "deleteChat");
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
    if (!res.ok) throw await readError(res, "rewindChat");
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
    if (!res.ok && res.status !== 409) throw await readError(res, "saveQueue");
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
    if (!res.ok && res.status !== 409) throw await readError(res, "sendQueued");
    return (await res.json()) as QueueState;
}
