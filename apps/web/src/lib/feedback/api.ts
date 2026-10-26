/**
 * The Feedback routes, from the browser. Every call rejects with a
 * `FeedbackApiError` carrying the server's own sentence (already in the
 * reader's language) when there is one, so screens can show it as is.
 */

import type {
    CreateFeedbackInput,
    FeedbackAccess,
    FeedbackDetail,
    FeedbackListItem,
    FeedbackReply,
    FeedbackScope,
    FeedbackStatus,
    BugSeverity,
    FeedbackKind,
} from "./contract";

export class FeedbackApiError extends Error {
    constructor(
        message: string,
        readonly status: number
    ) {
        super(message);
        this.name = "FeedbackApiError";
    }
}

async function read<T>(res: Response): Promise<T> {
    if (res.ok) return (await res.json()) as T;
    let message = "";
    try {
        const body = (await res.json()) as { error?: unknown; message?: unknown };
        message =
            typeof body.error === "string"
                ? body.error
                : typeof body.message === "string"
                  ? body.message
                  : "";
    } catch {
        // Not JSON — a proxy's error page. The status is all there is.
    }
    throw new FeedbackApiError(message, res.status);
}

const CHANGED = "launchstack:feedback-changed";

/** Something was sent, voted on or answered: lists on screen should reload. */
export function notifyFeedbackChanged(): void {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED));
}

export function onFeedbackChanged(listener: () => void): () => void {
    window.addEventListener(CHANGED, listener);
    return () => window.removeEventListener(CHANGED, listener);
}

const json = (body: unknown): RequestInit => ({
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
});

export function fetchFeedbackAccess(): Promise<FeedbackAccess> {
    return fetch("/api/feedback/me", { cache: "no-store" }).then(r => read<FeedbackAccess>(r));
}

export async function createFeedback(
    input: CreateFeedbackInput,
    images: Blob[]
): Promise<FeedbackDetail> {
    const form = new FormData();
    form.set("payload", JSON.stringify(input));
    images.forEach((image, i) => {
        const type = image.type || "image/png";
        const ext = type.split("/")[1] ?? "png";
        form.append("files", image, `screenshot-${i + 1}.${ext}`);
    });
    const res = await fetch("/api/feedback", { method: "POST", body: form });
    const { report } = await read<{ report: FeedbackDetail }>(res);
    notifyFeedbackChanged();
    return report;
}

export interface FeedbackListFilter {
    scope: FeedbackScope;
    kind?: FeedbackKind;
    status?: FeedbackStatus;
    q?: string;
    sort?: "votes" | "recent";
    limit?: number;
}

export async function listFeedback(
    filter: FeedbackListFilter,
    signal?: AbortSignal
): Promise<FeedbackListItem[]> {
    const params = new URLSearchParams({ scope: filter.scope });
    if (filter.kind) params.set("kind", filter.kind);
    if (filter.status) params.set("status", filter.status);
    if (filter.q?.trim()) params.set("q", filter.q.trim());
    if (filter.sort) params.set("sort", filter.sort);
    if (filter.limit) params.set("limit", String(filter.limit));
    const res = await fetch(`/api/feedback?${params.toString()}`, { cache: "no-store", signal });
    return (await read<{ items: FeedbackListItem[] }>(res)).items;
}

export async function getFeedback(id: number, signal?: AbortSignal): Promise<FeedbackDetail> {
    const res = await fetch(`/api/feedback/${id}`, { cache: "no-store", signal });
    return (await read<{ report: FeedbackDetail }>(res)).report;
}

export async function updateFeedback(
    id: number,
    patch: { status?: FeedbackStatus; severity?: BugSeverity | null }
): Promise<FeedbackDetail> {
    const res = await fetch(`/api/feedback/${id}`, { method: "PATCH", ...json(patch) });
    const { report } = await read<{ report: FeedbackDetail }>(res);
    notifyFeedbackChanged();
    return report;
}

export async function replyToFeedback(id: number, body: string): Promise<FeedbackReply> {
    const res = await fetch(`/api/feedback/${id}/replies`, { method: "POST", ...json({ body }) });
    const { reply } = await read<{ reply: FeedbackReply }>(res);
    notifyFeedbackChanged();
    return reply;
}

export async function voteForFeedback(
    id: number,
    vote: boolean
): Promise<{ votes: number; voted: boolean }> {
    const res = await fetch(`/api/feedback/${id}/vote`, { method: vote ? "PUT" : "DELETE" });
    const result = await read<{ votes: number; voted: boolean }>(res);
    notifyFeedbackChanged();
    return result;
}
