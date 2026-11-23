import {
    weeklyReviewFailureRecord,
    safeWeeklyReviewProviderOutcome,
    weeklyReviewProviderAttempt,
} from "~/server/vantage/weekly-review-failure-record";

const secret = "CONFIDENTIAL_SOURCE_MARKER";
it("retains only closed failure enums/rules and finite nonnegative integer counts", () => {
    const record = weeklyReviewFailureRecord(secret, {
        stage: secret,
        statusClass: secret,
        message: secret,
        path: secret,
        validatorCodes: ["invalid_source_citation", secret, "invalid_source_citation"],
        judgeCodes: ["judge_evidence_quote_invalid", secret],
        counts: {
            sourceUnits: 0,
            evidenceBytes: -1,
            messageBytes: NaN,
            citationsChecked: 4,
            citationsFailed: 1,
            providerAttempts: 2,
            providerFailures: Infinity,
            sourceIds: [secret],
        },
        provider: {
            statusClass: "rate_limited",
            httpStatus: 429,
            retryAfterMs: 2000,
            body: secret,
            usage: {
                inputTokens: 13,
                cachedInputTokens: 3,
                reasoningTokens: 0,
                outputTokens: -1,
                totalTokens: secret,
            },
        },
    });
    expect(record).toMatchObject({
        code: "candidate_not_admitted",
        stage: "unknown",
        statusClass: "unknown",
        validatorCodes: ["invalid_source_citation"],
        judgeCodes: ["judge_evidence_quote_invalid"],
        counts: {
            sourceUnits: 0,
            evidenceBytes: null,
            messageBytes: null,
            citationsChecked: 4,
            citationsFailed: 1,
            providerAttempts: 2,
            providerFailures: null,
        },
        provider: {
            statusClass: "rate_limited",
            httpStatus: 429,
            usage: {
                inputTokens: 13,
                cachedInputTokens: 3,
                reasoningTokens: 0,
                outputTokens: null,
                totalTokens: null,
            },
        },
    });
    expect(JSON.stringify(record)).not.toContain(secret);
});
it("uses stable unknown/null fallback for legacy failures without diagnostic evidence", () => {
    const first = weeklyReviewFailureRecord(null, null);
    expect(weeklyReviewFailureRecord(undefined, { error: secret })).toEqual(first);
    expect(Object.values(first.counts)).toEqual(Array(7).fill(null));
    expect(weeklyReviewFailureRecord("dispatch_uncertain_expired")).toMatchObject({
        stage: "recovery",
        statusClass: "timeout",
    });
});
it("does not expose unknown provider response fields or invent token totals", () => {
    const outcome = safeWeeklyReviewProviderOutcome({
        statusClass: secret,
        httpStatus: 999,
        retryAfterMs: "100",
        usage: { inputTokens: 2, outputTokens: 3 },
        error: secret,
    });
    expect(outcome).toMatchObject({
        statusClass: "unknown",
        httpStatus: null,
        retryAfterMs: null,
        usage: { inputTokens: 2, outputTokens: 3, totalTokens: null },
    });
    expect(JSON.stringify(outcome)).not.toContain(secret);
});
it("positively selects fields when decoding owner-visible attempt rows", () => {
    const result = weeklyReviewProviderAttempt({
        id: secret,
        stage: secret,
        attempt_ordinal: 1,
        message_bytes: 0,
        started_at: "invalid",
        settled_at: null,
        endpoint: secret,
        outcome: { body: secret },
    });
    expect(result).toMatchObject({
        id: "unavailable",
        stage: "unknown",
        status: "pending",
        startedAt: null,
        messageBytes: 0,
        outcome: { statusClass: "unknown" },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
});
