import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { latency, liveAccounting } from "./vantage-rag-live-accounting.mjs";

test("latency uses median and nearest-rank p95, with explicit absent samples", () => {
    assert.deepEqual(latency([]), {
        n: 0,
        min: null,
        median: null,
        p90: null,
        p95: null,
        max: null,
    });
    assert.deepEqual(latency([3, 1, 4, 2, undefined]), {
        n: 4,
        min: 1,
        median: 2.5,
        p90: 4,
        p95: 4,
        max: 4,
    });
    assert.equal(latency(Array.from({ length: 20 }, (_, i) => i + 1)).p95, 19);
    assert.equal(latency(Array.from({ length: 20 }, (_, i) => i + 1)).p90, 18);
});
test("partial capture preserves unknown reservations and sanitizes content", async () => {
    const cache = await mkdtemp(join(tmpdir(), "vantage-live-accounting-test-"));
    const evidence = join(cache, "live.evidence");
    try {
        await mkdir(evidence);
        const result = {
            caseId: "fixture",
            status: "failed",
            failure: "topic_exploration_failed:timeout",
            durationMs: 100,
            stageMs: { digest: 60, exploration: 40 },
            accounting: { digestProviderCalls: 1 },
        };
        const content = JSON.stringify({ error: "not_offered" });
        const checkpoint = {
            ...result,
            ledgerStart: 0,
            ledgerEnd: 2,
            trace: {
                events: [
                    {
                        kind: "tool",
                        name: "get_document_digest",
                        args: { ref: "PRIVATE_DOC_REF" },
                        content,
                        resultHash: createHash("sha256")
                            .update(JSON.stringify(content))
                            .digest("hex"),
                    },
                ],
            },
        };
        const ledger = {
            limitUsd: 15,
            settledListRateUsd: 0.01,
            reservedUsd: 0.02,
            hold: "usage_unresolved",
            records: [
                {
                    id: "1",
                    status: "settled",
                    projectedUsd: 0.02,
                    inputTokens: 100,
                    outputTokens: 50,
                    cachedInputTokens: 20,
                    reasoningTokens: 10,
                    settledListRateUsd: 0.01,
                    globalShortListRateUsd: 0.005,
                },
                { id: "2", status: "unknown", projectedUsd: 0.02 },
                { id: "3", status: "released", projectedUsd: 0.02, route: "digest" },
            ],
        };
        await writeFile(join(cache, "live.json"), JSON.stringify([result]));
        await writeFile(join(evidence, "case-01.json"), JSON.stringify(checkpoint));
        await writeFile(join(evidence, "usage-ledger.json"), JSON.stringify(ledger));
        await writeFile(
            join(evidence, "digests.json"),
            JSON.stringify([
                { id: "1", headline: "PRIVATE_HEADLINE", items: [{ text: "PRIVATE_CORPUS_TEXT" }] },
            ])
        );
        const report = await liveAccounting(join(cache, "live.json"));
        assert.equal(report.complete, false);
        assert.equal(report.calls.byRoute.digest.modelCalls, 1);
        assert.equal(report.calls.byRoute.exploration.modelCalls, 1);
        assert.equal(report.costs.conservativeTotalIncludingReservationsUsd, 0.03);
        assert.equal(report.costs.globalStandardTotalWithConservativeReservationsUsd, 0.025);
        assert.equal(report.nativeTokens.inputTokens.total, 100);
        assert.equal(report.nativeTokens.inputTokens.reportedRequests, 1);
        assert.equal(report.tools.executedByNameAndResult["get_document_digest/not_offered"], 1);
        assert.deepEqual(report.integrity.issues, []);
        assert.equal(report.integrity.filesRead, 4);
        assert(!JSON.stringify(report).includes("PRIVATE_"));
        await rename(join(evidence, "case-01.json"), join(evidence, "case-100.json"));
        const hundred = await liveAccounting(join(cache, "live.json"), { expectedCases: 100 });
        assert.equal(hundred.cases.expected, 100);
        assert.equal(hundred.complete, false);
        assert.equal(hundred.tools.perCase[0].caseNumber, 100);
        assert.equal(hundred.tools.perCase[0].invalidCallCount, 1);
        checkpoint.trace.version = 2;
        checkpoint.trace.events.push({
            kind: "tool_validation",
            name: "submit_result",
            callId: "fixture-call",
            code: "submission_invalid",
            content: "PRIVATE_VALIDATION_TEXT",
        });
        await writeFile(join(evidence, "case-100.json"), JSON.stringify(checkpoint));
        const validation = await liveAccounting(join(cache, "live.json"), { expectedCases: 100 });
        assert.equal(validation.tools.preHandlerValidationErrors, 1);
        assert.equal(validation.tools.perCase[0].invalidExecutedResults, 1);
        assert.equal(validation.tools.perCase[0].invalidCallCount, 2);
        assert.equal(validation.tools.perCase[0].preHandlerValidationObservable, true);
        assert(!JSON.stringify(validation).includes("PRIVATE_"));
        checkpoint.ledgerStart = 1;
        await writeFile(join(evidence, "case-100.json"), JSON.stringify(checkpoint));
        await writeFile(
            join(evidence, "warm-up.json"),
            JSON.stringify({
                ledgerStart: 0,
                ledgerEnd: 1,
                documents: 1,
                groundedDigests: 1,
                generatedProviderCalls: 1,
                cacheHits: 0,
                elapsedMs: 30,
            })
        );
        const warmed = await liveAccounting(join(cache, "live.json"), { expectedCases: 100 });
        assert.equal(warmed.calls.prewarmRequests, 1);
        assert.equal(warmed.costs.prewarmConservativeSettledUsd, 0.01);
        assert.deepEqual(warmed.integrity.issues, []);
    } finally {
        await rm(cache, { recursive: true, force: true });
    }
});
