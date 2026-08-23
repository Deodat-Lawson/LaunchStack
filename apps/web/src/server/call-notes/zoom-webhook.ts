import { createHmac, timingSafeEqual } from "node:crypto";

export type ZoomWebhookVerification =
    | { ok: true; timestampSeconds: number }
    | { ok: false; reason: "missing_headers" | "stale_timestamp" | "bad_signature" };

export interface ZoomWebhookHeaders {
    signature?: string | null;
    timestamp?: string | null;
}

const ZOOM_WEBHOOK_MAX_SKEW_SECONDS = 5 * 60;

/** Verifies Zoom's v0 signature against the exact raw request body. */
export function verifyZoomWebhook(input: {
    rawBody: string;
    secret: string;
    headers: ZoomWebhookHeaders;
    nowSeconds?: number;
}): ZoomWebhookVerification {
    const signature = input.headers.signature;
    const timestamp = input.headers.timestamp;
    if (!signature || !timestamp) return { ok: false, reason: "missing_headers" };

    const timestampSeconds = Number(timestamp);
    const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1_000);
    if (
        !Number.isSafeInteger(timestampSeconds) ||
        Math.abs(nowSeconds - timestampSeconds) > ZOOM_WEBHOOK_MAX_SKEW_SECONDS
    ) {
        return { ok: false, reason: "stale_timestamp" };
    }

    const expected = `v0=${createHmac("sha256", input.secret)
        .update(`v0:${timestamp}:${input.rawBody}`)
        .digest("hex")}`;
    const expectedBytes = Buffer.from(expected, "utf8");
    const providedBytes = Buffer.from(signature, "utf8");
    if (
        expectedBytes.length !== providedBytes.length ||
        !timingSafeEqual(expectedBytes, providedBytes)
    ) {
        return { ok: false, reason: "bad_signature" };
    }
    return { ok: true, timestampSeconds };
}

/** Response required by Zoom's endpoint.url_validation challenge. */
export function zoomEndpointValidationResponse(
    plainToken: string,
    secret: string
): {
    plainToken: string;
    encryptedToken: string;
} {
    if (!plainToken) throw new Error("Zoom endpoint validation token is required");
    return {
        plainToken,
        encryptedToken: createHmac("sha256", secret).update(plainToken).digest("hex"),
    };
}
