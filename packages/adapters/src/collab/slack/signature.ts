/**
 * Slack request signature verification (signing secret, `v0` scheme).
 *
 * Slack signs `v0:{timestamp}:{raw body}`. The raw body matters: re-serializing
 * the parsed JSON changes key order and whitespace and silently breaks
 * verification, which is why every caller must hand in the untouched string.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const SLACK_SIGNATURE_HEADER = "x-slack-signature";
export const SLACK_TIMESTAMP_HEADER = "x-slack-request-timestamp";

/** Slack's own recommendation: reject anything older than five minutes. */
export const SLACK_MAX_SKEW_SECONDS = 60 * 5;

export type SlackVerifyFailure = "missing_headers" | "stale_timestamp" | "bad_signature";

export interface SlackVerifyResult {
  ok: boolean;
  reason?: SlackVerifyFailure;
}

export function verifySlackRequest(input: {
  signingSecret: string;
  rawBody: string;
  headers: Record<string, string | undefined>;
  nowSeconds?: number;
  maxSkewSeconds?: number;
}): SlackVerifyResult {
  const headers = Object.fromEntries(
    Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const signature = headers[SLACK_SIGNATURE_HEADER];
  const timestamp = headers[SLACK_TIMESTAMP_HEADER];
  if (!signature || !timestamp) return { ok: false, reason: "missing_headers" };

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const skew = Math.abs(now - Number(timestamp));
  if (!Number.isFinite(skew) || skew > (input.maxSkewSeconds ?? SLACK_MAX_SKEW_SECONDS)) {
    return { ok: false, reason: "stale_timestamp" };
  }

  const expected = `v0=${createHmac("sha256", input.signingSecret)
    .update(`v0:${timestamp}:${input.rawBody}`)
    .digest("hex")}`;

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }
  return { ok: true };
}

/** Convenience for tests and for signing outbound fixtures. */
export function signSlackRequest(signingSecret: string, rawBody: string, timestampSeconds: number): Record<string, string> {
  return {
    [SLACK_TIMESTAMP_HEADER]: String(timestampSeconds),
    [SLACK_SIGNATURE_HEADER]: `v0=${createHmac("sha256", signingSecret)
      .update(`v0:${timestampSeconds}:${rawBody}`)
      .digest("hex")}`,
  };
}
