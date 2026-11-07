import type { DecisionInput } from "../api";

// Only a digest and random key are retained, never the decision or source body.
const pending = new Map<string, { digest: string; key: string }>();

export function normalizeDecision(input: DecisionInput): DecisionInput {
    return {
        decision: input.decision.trim(),
        commitment: input.commitment
            ? {
                  title: input.commitment.title.trim(),
                  owner: input.commitment.owner.trim(),
                  dueOn: input.commitment.dueOn,
                  test: input.commitment.test?.trim() ? input.commitment.test.trim() : null,
                  shared: false,
              }
            : null,
    };
}

/** Keep a logical submission's key through network failures and page reloads. */
export async function decisionKey(topicId: string, input: DecisionInput): Promise<string> {
    const bytes = new TextEncoder().encode(JSON.stringify(normalizeDecision(input)));
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    const digest = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
    const storageKey = `vantage:decision:v1:${topicId}`;
    let prior = pending.get(topicId);
    try {
        const stored: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
        if (
            stored &&
            typeof stored === "object" &&
            "digest" in stored &&
            "key" in stored &&
            typeof stored.digest === "string" &&
            typeof stored.key === "string"
        ) {
            prior = { digest: stored.digest, key: stored.key };
        }
    } catch {
        /* Storage may be unavailable; the mounted app still keeps the key. */
    }
    if (prior?.digest === digest) return prior.key;
    const attempt = { digest, key: crypto.randomUUID() };
    pending.set(topicId, attempt);
    try {
        sessionStorage.setItem(storageKey, JSON.stringify(attempt));
    } catch {
        /* In-memory fallback. */
    }
    return attempt.key;
}

export function completeDecision(topicId: string) {
    pending.delete(topicId);
    try {
        sessionStorage.removeItem(`vantage:decision:v1:${topicId}`);
    } catch {
        /* In-memory fallback. */
    }
}
