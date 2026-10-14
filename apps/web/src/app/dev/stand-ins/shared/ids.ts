/**
 * Identifier and signing helpers for the stand-ins: opaque tokens, HS256
 * JWTs, real CIDv1 strings (so `bafkrei…` / `bafyrei…` look and parse like
 * the network's), atproto TIDs, and SVG monograms for logos and avatars.
 */
import { createHash, createHmac, randomBytes } from "node:crypto";

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Random [A-Za-z0-9] string. */
export function randomId(length: number): string {
    const raw = randomBytes(length);
    let out = "";
    for (let i = 0; i < length; i++) out += ALNUM[raw[i]! % ALNUM.length];
    return out;
}

export function randomToken(prefix: string, byteLength = 96): string {
    return prefix + randomBytes(byteLength).toString("base64url");
}

function b64url(value: unknown): string {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** An HS256-signed JWT. */
export function signJwt(
    header: Record<string, unknown>,
    payload: Record<string, unknown>,
    secret: string
): string {
    const head = b64url({ alg: "HS256", ...header });
    const body = b64url(payload);
    const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
    return `${head}.${body}.${sig}`;
}

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

function base32(data: Uint8Array): string {
    let out = "";
    let bits = 0;
    let value = 0;
    for (const byte of data) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            out += BASE32[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
    return out;
}

/** CIDv1, sha2-256, base32: codec 0x55 (raw) → "bafkrei…", 0x71 (dag-cbor) → "bafyrei…". */
export function cidFor(data: Uint8Array | string, codec: "raw" | "dag-cbor"): string {
    const digest = createHash("sha256").update(data).digest();
    const prefix = Uint8Array.from([0x01, codec === "raw" ? 0x55 : 0x71, 0x12, 0x20]);
    const full = new Uint8Array(prefix.length + digest.length);
    full.set(prefix, 0);
    full.set(digest, prefix.length);
    return `b${base32(full)}`;
}

const S32 = "234567abcdefghijklmnopqrstuvwxyz";

/** An atproto TID (13 chars, base32-sortable) from a microsecond timestamp. */
export function tidFrom(micros: bigint, clockId = 7): string {
    let v = (micros << 10n) | BigInt(clockId & 1023);
    let out = "";
    for (let i = 0; i < 13; i++) {
        out = S32[Number(v & 31n)]! + out;
        v >>= 5n;
    }
    return out;
}

function escapeXml(text: string): string {
    return text.replace(/[<>&"']/g, c => `&#${c.charCodeAt(0)};`);
}

/**
 * A square monogram. These are served as third-party images (a Page logo, a
 * member photo), so the fill is part of the picture, not app chrome.
 */
export function monogramSvg(initials: string, hue: number, rounded: boolean): string {
    const radius = rounded ? 48 : 14;
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">`,
        `<rect width="96" height="96" rx="${radius}" fill="hsl(${hue}, 55%, 42%)"/>`,
        `<text x="48" y="61" text-anchor="middle" font-size="38" font-weight="600" fill="white">`,
        escapeXml(initials),
        `</text></svg>`,
    ].join("");
}
