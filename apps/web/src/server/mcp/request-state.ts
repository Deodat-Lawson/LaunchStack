/**
 * `requestState` for multi round-trip requests (MCP 2026-07-28).
 *
 * When a tool needs the person's answer (a native form in Claude Code or
 * ChatGPT), it returns `input_required` with an opaque `requestState`. The
 * client echoes that string back, unchanged, on the retry that carries the
 * answers. The client controls every byte of it, so it is signed: an HMAC
 * over what it binds — the tool, the person, the workspace, a digest of the
 * call's arguments and an expiry — keyed from the server's auth secret. A
 * state minted for one person, tool or argument set fails for any other, and
 * an old one fails once it expires. Single use is the tool's job (the staged
 * draft it points at can be filed once).
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** How long a person has to answer a form before the state stops working. */
export const REQUEST_STATE_TTL_MS = 30 * 60 * 1000;

interface StatePayload {
    v: 1;
    /** Tool name. */
    t: string;
    /** Auth user id. */
    u: string;
    /** Workspace (company id, decimal). */
    w: string;
    /** Expiry, epoch milliseconds. */
    e: number;
    /** Digest of the call's arguments. */
    d: string;
    /** Whatever the tool needs to resume. */
    s: Record<string, unknown>;
}

export interface RequestStateBinding {
    tool: string;
    authUserId: string;
    companyId: bigint;
    /** `argumentsDigest(arguments)` of the call the state belongs to. */
    argumentsDigest: string;
}

export type RequestStateCheck =
    | { ok: true; data: Record<string, unknown> }
    | { ok: false; reason: "malformed" | "signature" | "expired" | "mismatch" };

function signingKey(): Buffer {
    const secret = process.env.BETTER_AUTH_SECRET?.trim();
    if (!secret) throw new Error("BETTER_AUTH_SECRET is not set; cannot sign MCP request state");
    return createHash("sha256").update(`launchstack-mcp-request-state\0${secret}`).digest();
}

function mac(body: string): string {
    return createHmac("sha256", signingKey()).update(body).digest("base64url");
}

/** JSON with object keys sorted at every depth, so equal values hash equally. */
export function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (value !== null && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, entry]) => entry !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
        return `{${entries.join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

/** Hex SHA-256 of a tool call's arguments, independent of key order. */
export function argumentsDigest(args: unknown): string {
    return createHash("sha256")
        .update(canonicalJson(args ?? {}))
        .digest("hex");
}

export function signRequestState(
    binding: RequestStateBinding,
    data: Record<string, unknown>,
    now = Date.now()
): string {
    const payload: StatePayload = {
        v: 1,
        t: binding.tool,
        u: binding.authUserId,
        w: binding.companyId.toString(),
        e: now + REQUEST_STATE_TTL_MS,
        d: binding.argumentsDigest,
        s: data,
    };
    const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return `${body}.${mac(body)}`;
}

export function verifyRequestState(
    raw: string,
    binding: RequestStateBinding,
    now = Date.now()
): RequestStateCheck {
    const dot = raw.indexOf(".");
    if (dot <= 0 || dot !== raw.lastIndexOf(".")) return { ok: false, reason: "malformed" };
    const body = raw.slice(0, dot);
    const given = Buffer.from(raw.slice(dot + 1), "base64url");
    const expected = Buffer.from(mac(body), "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        return { ok: false, reason: "signature" };
    }
    let payload: StatePayload;
    try {
        payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatePayload;
    } catch {
        return { ok: false, reason: "malformed" };
    }
    if (payload.v !== 1 || typeof payload.s !== "object" || payload.s === null) {
        return { ok: false, reason: "malformed" };
    }
    if (typeof payload.e !== "number" || payload.e <= now) return { ok: false, reason: "expired" };
    if (
        payload.t !== binding.tool ||
        payload.u !== binding.authUserId ||
        payload.w !== binding.companyId.toString() ||
        payload.d !== binding.argumentsDigest
    ) {
        return { ok: false, reason: "mismatch" };
    }
    return { ok: true, data: payload.s };
}
