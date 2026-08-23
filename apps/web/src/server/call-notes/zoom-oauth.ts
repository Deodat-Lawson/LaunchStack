import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

const IV_BYTES = 12;
const TAG_BYTES = 16;
const STATE_TTL_MS = 10 * 60_000;

export interface ZoomOAuthState {
    userId: string;
    companyId: string;
    expiresAt: number;
}

function decodeKey(keyBase64: string): Buffer {
    const key = Buffer.from(keyBase64, "base64");
    if (key.length !== 32) {
        throw new Error("ZOOM_TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as base64");
    }
    return key;
}

export function encryptZoomSecret(plaintext: string, keyBase64: string, purpose: string): string {
    if (!plaintext) throw new Error("Refusing to encrypt an empty Zoom secret");
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", decodeKey(keyBase64), iv);
    cipher.setAAD(Buffer.from(purpose, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

export function decryptZoomSecret(envelope: string, keyBase64: string, purpose: string): string {
    const payload = Buffer.from(envelope, "base64url");
    if (payload.length <= IV_BYTES + TAG_BYTES) throw new Error("Invalid Zoom secret envelope");
    const iv = payload.subarray(0, IV_BYTES);
    const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", decodeKey(keyBase64), iv);
    decipher.setAAD(Buffer.from(purpose, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function createZoomOAuthState(
    userId: string,
    companyId: string,
    keyBase64: string,
    now = Date.now()
): string {
    return encryptZoomSecret(
        JSON.stringify({ userId, companyId, expiresAt: now + STATE_TTL_MS }),
        keyBase64,
        "zoom-oauth-state"
    );
}

export function verifyZoomOAuthState(input: {
    queryState: string;
    cookieState: string;
    keyBase64: string;
    now?: number;
}): ZoomOAuthState {
    const queryBytes = Buffer.from(input.queryState, "utf8");
    const cookieBytes = Buffer.from(input.cookieState, "utf8");
    if (queryBytes.length !== cookieBytes.length || !timingSafeEqual(queryBytes, cookieBytes)) {
        throw new Error("Zoom OAuth state mismatch");
    }

    const decoded = JSON.parse(
        decryptZoomSecret(input.queryState, input.keyBase64, "zoom-oauth-state")
    ) as Partial<ZoomOAuthState>;
    if (
        typeof decoded.userId !== "string" ||
        typeof decoded.companyId !== "string" ||
        typeof decoded.expiresAt !== "number" ||
        decoded.expiresAt < (input.now ?? Date.now())
    ) {
        throw new Error("Zoom OAuth state is invalid or expired");
    }
    return decoded as ZoomOAuthState;
}
