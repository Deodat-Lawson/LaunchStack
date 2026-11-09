import type { DemoSource, DemoSourceRef, DemoState, DemoTopicReview } from "./demo-contract";

export class DemoApiError extends Error {
    constructor(
        message: string,
        readonly status: number
    ) {
        super(message);
        this.name = "DemoApiError";
    }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`/api/vantage/demo${path}`, {
        credentials: "same-origin",
        cache: "no-store",
        ...init,
    });
    const body = (await response.json().catch(() => null)) as {
        error?: unknown;
        message?: unknown;
    } | null;
    if (!response.ok) {
        const message =
            typeof body?.error === "string"
                ? body.error
                : typeof body?.message === "string"
                  ? body.message
                  : "Could not load the local Vantage demo.";
        throw new DemoApiError(message, response.status);
    }
    return body as T;
}

const json = (method: "POST" | "PATCH", body: unknown): RequestInit => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
});

export const vantageDemoApi = {
    state: (week?: string) => request<DemoState>(week ? `?${new URLSearchParams({ week })}` : ""),
    generate: (weekStart: string, signal?: AbortSignal) =>
        request<DemoState>("", { ...json("POST", { weekStart }), signal }),
    review: (review: DemoTopicReview) => request<DemoState>("/topics", json("PATCH", review)),
    source: (reportId: string, source: DemoSourceRef, signal?: AbortSignal) =>
        request<DemoSource>(
            `/source?${new URLSearchParams({ reportId, kind: source.kind, id: source.id, version: source.version })}`,
            { signal }
        ),
};

export const demoSourceKey = (source: DemoSourceRef) =>
    JSON.stringify([source.kind, source.id, source.version]);
export const demoSourceName = (source: DemoSourceRef) =>
    `${source.kind}:${source.id}@${source.version}`;
