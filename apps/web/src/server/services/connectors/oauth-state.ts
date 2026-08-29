/**
 * The OAuth `state` parameter for workspace connections: HMAC-signed, no
 * database table.
 *
 * Payload is {provider, companyId, userPk, nonce, iat}; the signing key is
 * derived (HKDF) from EMBEDDING_SECRETS_KEY — the connector layer already
 * hard-requires that key for token encryption, so no new secret is
 * introduced. The nonce is doubled into an httpOnly cookie by the start
 * route; the callback requires signature, freshness, cookie/state nonce
 * equality, AND that the signed-in user matches the payload.
 */

import { createHmac, hkdfSync, randomBytes } from "node:crypto";

import { timingSafeStringEqual } from "@launchstack/store/crypto";

import { env } from "~/env";
import type { ConnectorProvider } from "~/server/db/schema/connectors";
import { isConnectorProvider } from "~/server/db/schema/connectors";

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** Scoped per provider so parallel connect flows cannot clobber each other. */
export function oauthNonceCookieName(provider: ConnectorProvider): string {
    return `connector_oauth_nonce_${provider.replace(/-/g, "_")}`;
}

export interface OAuthStatePayload {
    readonly provider: ConnectorProvider;
    readonly companyId: string;
    readonly userPk: number;
    readonly nonce: string;
    readonly iat: number;
}

function signingKey(): Buffer {
    const master = env.server.EMBEDDING_SECRETS_KEY;
    if (!master) {
        throw new Error("EMBEDDING_SECRETS_KEY is required for workspace connections");
    }
    return Buffer.from(
        hkdfSync("sha256", Buffer.from(master, "base64"), "", "connector-oauth-state", 32)
    );
}

function mac(payload: string): string {
    return createHmac("sha256", signingKey()).update(payload, "utf8").digest("base64url");
}

export function createNonce(): string {
    return randomBytes(16).toString("hex");
}

export function signState(payload: OAuthStatePayload): string {
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return `${encoded}.${mac(encoded)}`;
}

/** Returns the payload only when the signature is valid and the TTL fresh. */
export function verifyState(state: string, now: number = Date.now()): OAuthStatePayload | null {
    const [encoded, signature] = state.split(".");
    if (!encoded || !signature) return null;
    if (!timingSafeStringEqual(mac(encoded), signature)) return null;

    let payload: OAuthStatePayload;
    try {
        payload = JSON.parse(
            Buffer.from(encoded, "base64url").toString("utf8")
        ) as OAuthStatePayload;
    } catch {
        return null;
    }
    if (
        typeof payload.provider !== "string" ||
        !isConnectorProvider(payload.provider) ||
        typeof payload.companyId !== "string" ||
        typeof payload.userPk !== "number" ||
        typeof payload.nonce !== "string" ||
        typeof payload.iat !== "number"
    ) {
        return null;
    }
    if (now - payload.iat > OAUTH_STATE_TTL_MS) return null;
    return payload;
}
