/**
 * Signed HTTP client for the meeting hub.
 *
 * `hubUrl` is the mount root: the canonical path (`/collab/v1/…`) is appended
 * to it verbatim. A bare hub server takes `http://10.0.0.4:4100`; the Next.js
 * mount takes `https://app.example.com/api`, which resolves to
 * `https://app.example.com/api/collab/v1/…`. The signature covers the
 * canonical path, not the mount prefix, so the same worker binary talks to
 * either deployment without reconfiguration.
 */

import { COLLAB_API_PREFIX, signRequest, type HubEvent } from "./protocol";
import type { ChannelMessage, MeetingConfig, MeetingState } from "../types";
import type { MeetingMinutes } from "../types";

export interface HubClientOptions {
    hubUrl: string;
    nodeId: string;
    secret: string;
    /** Injected for tests; defaults to global fetch. */
    fetchImpl?: typeof fetch;
    /** Per-request timeout. Long polls override it with their own wait. */
    timeoutMs?: number;
}

export class HubRequestError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code?: string
    ) {
        super(message);
        this.name = "HubRequestError";
    }
}

export class HubClient {
    private readonly hubUrl: string;
    private readonly fetchImpl: typeof fetch;

    constructor(private readonly options: HubClientOptions) {
        this.hubUrl = options.hubUrl.replace(/\/+$/, "");
        this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    }

    get nodeId(): string {
        return this.options.nodeId;
    }

    async request<T>(
        method: string,
        canonicalPath: string,
        body?: unknown,
        init: { timeoutMs?: number; signal?: AbortSignal } = {}
    ): Promise<T> {
        const payload = body === undefined ? "" : JSON.stringify(body);
        const headers = signRequest({
            secret: this.options.secret,
            method,
            path: canonicalPath,
            body: payload,
            nodeId: this.options.nodeId,
        });

        const timeoutMs = init.timeoutMs ?? this.options.timeoutMs ?? 30_000;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        timer.unref?.();
        const onAbort = () => controller.abort();
        init.signal?.addEventListener("abort", onAbort);

        try {
            const response = await this.fetchImpl(`${this.hubUrl}${canonicalPath}`, {
                method,
                headers,
                body: method === "GET" || method === "HEAD" ? undefined : payload,
                signal: controller.signal,
            });
            const text = await response.text();
            if (!response.ok) {
                const parsed = safeParse<{ error?: string; code?: string }>(text);
                throw new HubRequestError(
                    parsed?.error ?? `Hub returned ${response.status}`,
                    response.status,
                    parsed?.code
                );
            }
            return (text ? JSON.parse(text) : {}) as T;
        } finally {
            clearTimeout(timer);
            init.signal?.removeEventListener("abort", onAbort);
        }
    }

    // --- node lifecycle -------------------------------------------------------

    register(input: { personaIds: string[]; label?: string; protocolVersion?: string }) {
        return this.request<{ ok: true; hubId: string; heartbeatIntervalMs: number }>(
            "POST",
            `${COLLAB_API_PREFIX}/nodes/register`,
            { nodeId: this.options.nodeId, ...input }
        );
    }

    poll(waitMs: number, signal?: AbortSignal) {
        return this.request<{ ok: true; events: HubEvent[] }>(
            "POST",
            `${COLLAB_API_PREFIX}/nodes/poll`,
            { nodeId: this.options.nodeId, waitMs },
            // Give the socket headroom beyond the hub's hold so a healthy long poll
            // is never mistaken for a hung request.
            { timeoutMs: waitMs + 15_000, signal }
        );
    }

    deregister() {
        return this.request<{ ok: true }>("POST", `${COLLAB_API_PREFIX}/nodes/deregister`, {
            nodeId: this.options.nodeId,
        });
    }

    submitTurnResult(requestId: string, payload: { result?: unknown; error?: string }) {
        return this.request<{ ok: true }>(
            "POST",
            `${COLLAB_API_PREFIX}/turns/${encodeURIComponent(requestId)}/result`,
            { nodeId: this.options.nodeId, requestId, ...payload }
        );
    }

    // --- channels -------------------------------------------------------------

    getMessages(channelId: string, afterSeq = 0) {
        return this.request<{ ok: true; messages: ChannelMessage[] }>(
            "GET",
            `${COLLAB_API_PREFIX}/channels/${encodeURIComponent(channelId)}/messages?afterSeq=${afterSeq}`
        );
    }

    postMessage(
        channelId: string,
        input: { text: string; author: ChannelMessage["author"]; threadId?: string }
    ) {
        return this.request<{ ok: true; message: ChannelMessage }>(
            "POST",
            `${COLLAB_API_PREFIX}/channels/${encodeURIComponent(channelId)}/messages`,
            input
        );
    }

    // --- meetings -------------------------------------------------------------

    getMeeting(meetingId: string) {
        return this.request<{
            ok: true;
            config: MeetingConfig;
            state: MeetingState;
            minutes: MeetingMinutes;
        }>("GET", `${COLLAB_API_PREFIX}/meetings/${encodeURIComponent(meetingId)}`);
    }

    control(
        meetingId: string,
        payload: {
            action:
                | "start"
                | "step"
                | "run"
                | "pause"
                | "resume"
                | "takeover"
                | "release"
                | "complete";
            limit?: number;
            humanId?: string;
            displayName?: string;
            asPersonaId?: string;
            reason?: string;
        },
        init: { timeoutMs?: number } = {}
    ) {
        return this.request<{ ok: true; state: MeetingState }>(
            "POST",
            `${COLLAB_API_PREFIX}/meetings/${encodeURIComponent(meetingId)}/control`,
            payload,
            init
        );
    }

    postHumanMessage(
        meetingId: string,
        payload: { humanId: string; displayName: string; text: string; asPersonaId?: string }
    ) {
        return this.request<{ ok: true; message: ChannelMessage; state: MeetingState }>(
            "POST",
            `${COLLAB_API_PREFIX}/meetings/${encodeURIComponent(meetingId)}/messages`,
            payload
        );
    }

    /** Unauthenticated liveness probe — safe to expose to a load balancer. */
    async health(): Promise<{ ok: boolean; hubId: string; nodes: unknown[] }> {
        const response = await this.fetchImpl(`${this.hubUrl}${COLLAB_API_PREFIX}/health`);
        return (await response.json()) as { ok: boolean; hubId: string; nodes: unknown[] };
    }
}

function safeParse<T>(text: string): T | null {
    try {
        return JSON.parse(text) as T;
    } catch {
        return null;
    }
}
