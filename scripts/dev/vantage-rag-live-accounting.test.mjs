import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { latency, liveAccounting } from "./vantage-rag-live-accounting.mjs";

test("latency uses median and nearest-rank p95, with explicit absent samples", () => {
    assert.deepEqual(latency([]), { n: 0, min: null, median: null, p95: null, max: null });
    assert.deepEqual(latency([3, 1, 4, 2, undefined]), {
        n: 4,
        min: 1,
        median: 2.5,
        p95: 4,
        max: 4,
    });
    assert.equal(latency(Array.from({ length: 20 }, (_, i) => i + 1)).p95, 19);
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
    } finally {
        await rm(cache, { recursive: true, force: true });
    }
});
