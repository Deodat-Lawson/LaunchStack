import type { HistoryEntry, HistoryKind } from "~/lib/workspace-history";

/**
 * The client's half of session persistence — every call the workspace makes to
 * keep a chat, reopen it, rename it, or drop it, in one place.
 *
 * Mirrors `sourceApi`: the components above this know about threads and
 * history rows, never about routes or JSON envelopes.
 */

export interface SessionMessagePayload {
    role: "user" | "assistant";
    text: string;
    refs?: string[];
    citations?: unknown[];
    attachments?: unknown[];
    model?: string | null;
    tokens?: number | null;
    /** Agent handle that produced (assistant) or was addressed by (user) the turn. */
    agentKey?: string | null;
}

export interface StoredSession {
    id: string;
    title: string;
    messageCount: number;
    pinned: boolean;
    contextSourceIds: string[];
    /** The agent the chat is held with; null = the default assistant. */
    agentKey?: string | null;
    lastMessageAt: string;
    createdAt: string;
    continuation?: { title: string; context: string } | null;
    messages?: (SessionMessagePayload & { seq: number; createdAt: string })[];
}

export interface HistoryPage {
    entries: HistoryEntry[];
    degraded: HistoryKind[];
}

async function readError(res: Response, fallback: string): Promise<Error> {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    return new Error(body.message ?? body.error ?? fallback);
}

export async function fetchHistory(limit?: number): Promise<HistoryPage> {
    const query = limit ? `?limit=${limit}` : "";
    const res = await fetch(`/api/workspace/history${query}`);
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

export async function deleteSession(sessionId: string): Promise<void> {
    const res = await fetch(`/api/workspace/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
    });
    if (!res.ok) throw await readError(res, "Failed to delete this chat");
}
