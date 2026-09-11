/**
 * Wire protocol for cross-machine meetings.
 *
 * Two processes on two machines have to agree on three things: how a request
 * is authenticated, what an event looks like, and how a turn request is
 * correlated with its result. That is all this file defines — the transport is
 * plain HTTP + JSON so it survives every proxy, tunnel, and load balancer
 * between the two hosts.
 *
 * Authentication is a shared-secret HMAC over a canonical string that binds
 * the method, path, body, timestamp, and a nonce. Signatures expire and nonces
 * are single-use, so a captured request cannot be replayed.
 */

import { createHmac, randomUUID, timingSafeEqual, createHash } from "node:crypto";

import type { AgentPersona, ChannelMessage, MeetingState } from "../types";

export const COLLAB_PROTOCOL_VERSION = "1";
export const COLLAB_API_PREFIX = "/collab/v1";

export const HEADER_NODE = "x-collab-node";
export const HEADER_TIMESTAMP = "x-collab-timestamp";
export const HEADER_NONCE = "x-collab-nonce";
export const HEADER_SIGNATURE = "x-collab-signature";
export const HEADER_VERSION = "x-collab-version";

/** Requests older than this are rejected outright. */
export const SIGNATURE_MAX_SKEW_MS = 5 * 60_000;

// ---------------------------------------------------------------------------
// Events (hub → node)
// ---------------------------------------------------------------------------

export interface TurnRequestEvent {
    type: "turn.request";
    requestId: string;
    meetingId: string;
    persona: AgentPersona;
    /** Serialized `TurnContext` — structurally identical, kept loose on the wire. */
    context: {
        meetingId: string;
        title: string;
        objective: string;
        agenda: string[];
        context: string[];
        roster: Array<{ id: string; displayName: string; role: string }>;
        turnIndex: number;
        maxTurns: number;
        completionMarker: string;
    };
    transcript: ChannelMessage[];
    /** Absolute deadline in epoch ms; a worker past it should not bother replying. */
    deadlineAt: number;
}

export interface MessageEvent {
    type: "channel.message";
    channelId: string;
    message: ChannelMessage;
}

export interface MeetingStateEvent {
    type: "meeting.state";
    meetingId: string;
    state: MeetingState;
}

export interface CancelEvent {
    type: "turn.cancel";
    requestId: string;
    reason: string;
}

export type HubEvent = TurnRequestEvent | MessageEvent | MeetingStateEvent | CancelEvent;

// ---------------------------------------------------------------------------
// Request / response bodies
// ---------------------------------------------------------------------------

export interface RegisterRequest {
    nodeId: string;
    /** Personas this worker is prepared to serve. */
    personaIds: string[];
    /** Human-readable, for the operator UI. */
    label?: string;
    protocolVersion?: string;
}

export interface RegisterResponse {
    ok: true;
    nodeId: string;
    hubId: string;
    protocolVersion: string;
    /** Milliseconds a node may stay silent before the hub considers it gone. */
    heartbeatIntervalMs: number;
}

export interface PollRequest {
    nodeId: string;
    /** How long the hub may hold the request open before replying empty. */
    waitMs?: number;
}

export interface PollResponse {
    ok: true;
    events: HubEvent[];
}

export interface TurnResultRequest {
    nodeId: string;
    requestId: string;
    result?: {
        text: string;
        addressedTo?: string[];
        proposesCompletion?: boolean;
        meta?: Record<string, unknown>;
    };
    error?: string;
}

export interface ErrorResponse {
    ok: false;
    error: string;
    code:
        | "unauthorized"
        | "bad_request"
        | "not_found"
        | "conflict"
        | "unsupported_version"
        | "internal";
}

// ---------------------------------------------------------------------------
// Framework-agnostic request/response
// ---------------------------------------------------------------------------

export interface HubHttpRequest {
    method: string;
    /** Path including the `/collab/v1` prefix. Query string allowed. */
    path: string;
    headers: Record<string, string>;
    body: string;
}

export interface HubHttpResponse {
    status: number;
    headers: Record<string, string>;
    body: string;
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

export function sha256Hex(input: string): string {
    return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * The exact bytes both sides sign. Path is taken *with* its query string: a
 * signature must not survive someone rewriting `?afterSeq=0` to `?afterSeq=99`.
 */
export function canonicalString(input: {
    method: string;
    path: string;
    timestamp: string;
    nonce: string;
    body: string;
}): string {
    return [
        `v${COLLAB_PROTOCOL_VERSION}`,
        input.method.toUpperCase(),
        input.path,
        input.timestamp,
        input.nonce,
        sha256Hex(input.body),
    ].join("\n");
}

export function signRequest(input: {
    secret: string;
    method: string;
    path: string;
    body: string;
    nodeId: string;
    timestamp?: number;
    nonce?: string;
}): Record<string, string> {
    const timestamp = String(input.timestamp ?? Date.now());
    const nonce = input.nonce ?? randomUUID();
    const signature = createHmac("sha256", input.secret)
        .update(
            canonicalString({
                method: input.method,
                path: input.path,
                timestamp,
                nonce,
                body: input.body,
            })
        )
        .digest("hex");

    return {
        [HEADER_NODE]: input.nodeId,
        [HEADER_TIMESTAMP]: timestamp,
        [HEADER_NONCE]: nonce,
        [HEADER_SIGNATURE]: `v${COLLAB_PROTOCOL_VERSION}=${signature}`,
        [HEADER_VERSION]: COLLAB_PROTOCOL_VERSION,
        "content-type": "application/json",
    };
}

export type VerifyFailure =
    | "missing_headers"
    | "stale_timestamp"
    | "replayed_nonce"
    | "bad_signature"
    | "unsupported_version";

export interface VerifyResult {
    ok: boolean;
    nodeId?: string;
    reason?: VerifyFailure;
}

/**
 * Bounded nonce cache. Entries expire with the signature window, so memory is
 * O(requests per 5 minutes) rather than unbounded.
 */
export class NonceCache {
    private readonly seen = new Map<string, number>();

    constructor(private readonly ttlMs: number = SIGNATURE_MAX_SKEW_MS) {}

    /** Returns false when the nonce was already used inside the window. */
    claim(nonce: string, now: number): boolean {
        this.evict(now);
        if (this.seen.has(nonce)) return false;
        this.seen.set(nonce, now + this.ttlMs);
        return true;
    }

    private evict(now: number): void {
        if (this.seen.size < 512) return;
        for (const [nonce, expiry] of this.seen) {
            if (expiry <= now) this.seen.delete(nonce);
        }
    }
}

export function verifyRequest(input: {
    secret: string;
    method: string;
    path: string;
    body: string;
    headers: Record<string, string>;
    now?: number;
    nonces?: NonceCache;
    maxSkewMs?: number;
}): VerifyResult {
    const headers = lowercaseHeaders(input.headers);
    const nodeId = headers[HEADER_NODE];
    const timestamp = headers[HEADER_TIMESTAMP];
    const nonce = headers[HEADER_NONCE];
    const signature = headers[HEADER_SIGNATURE];

    if (!nodeId || !timestamp || !nonce || !signature) {
        return { ok: false, reason: "missing_headers" };
    }

    const version = headers[HEADER_VERSION] ?? COLLAB_PROTOCOL_VERSION;
    if (version !== COLLAB_PROTOCOL_VERSION) {
        return { ok: false, reason: "unsupported_version" };
    }

    const now = input.now ?? Date.now();
    const skew = Math.abs(now - Number(timestamp));
    if (!Number.isFinite(skew) || skew > (input.maxSkewMs ?? SIGNATURE_MAX_SKEW_MS)) {
        return { ok: false, reason: "stale_timestamp" };
    }

    const expected = createHmac("sha256", input.secret)
        .update(
            canonicalString({
                method: input.method,
                path: input.path,
                timestamp,
                nonce,
                body: input.body,
            })
        )
        .digest("hex");
    const provided = signature.startsWith(`v${COLLAB_PROTOCOL_VERSION}=`)
        ? signature.slice(`v${COLLAB_PROTOCOL_VERSION}=`.length)
        : signature;

    if (!constantTimeEquals(expected, provided)) {
        return { ok: false, reason: "bad_signature" };
    }

    // Nonce is claimed only after the signature checks out, so an attacker
    // cannot exhaust the cache with garbage.
    if (input.nonces && !input.nonces.claim(nonce, now)) {
        return { ok: false, reason: "replayed_nonce" };
    }

    return { ok: true, nodeId };
}

function constantTimeEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
}

export function lowercaseHeaders(
    headers: Record<string, string | string[] | undefined>
): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
        if (v === undefined) continue;
        out[k.toLowerCase()] = Array.isArray(v) ? (v[0] ?? "") : v;
    }
    return out;
}

export function jsonResponse(status: number, payload: unknown): HubHttpResponse {
    return {
        status,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
    };
}

export function errorResponse(
    status: number,
    code: ErrorResponse["code"],
    error: string
): HubHttpResponse {
    return jsonResponse(status, { ok: false, code, error } satisfies ErrorResponse);
}
