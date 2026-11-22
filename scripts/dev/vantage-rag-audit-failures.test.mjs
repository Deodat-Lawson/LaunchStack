import { test } from "node:test";
import assert from "node:assert/strict";
import {
    projectJob,
    classifyFailures,
    buildFailureAudit,
    AUDIT_SCHEMA,
} from "./vantage-rag-audit-failures.mjs";

function job(
    workId,
    changes = {},
    events = [{ kind: "request" }, { kind: "failure", code: "Error" }]
) {
    return projectJob({
        workId,
        primary: {
            workId,
            caseId: "g3-" + "a".repeat(64),
            cohort: "heldout",
            retrievalLimits: { sharedEvidenceBytes: 16000 },
            arm: "configured-live",
            status: "failed",
            failure: "topic_exploration_failed:provider_or_submission",
            durationMs: 500,
            stageMs: { exploration: 450 },
            ...changes,
        },
        trace: { events },
    });
}
const transport = workId => ({
    workId,
    status: "unknown",
    durationMs: 70,
    failure: "usage_unresolved",
    continuedAfterTransportFailure: true,
});
const settled = workId => ({ workId, status: "settled", httpStatus: 200, durationMs: 400 });

test("shared-hold cascades bind to a transport sibling outside the retry-eligible cap", () => {
    const jobs = [
        job("sweep-001"),
        job("sweep-002", { durationMs: 100, retrievalLimits: { sharedEvidenceBytes: 80000 } }),
    ];
    const ledger = {
        records: [transport("sweep-002"), settled("sweep-001")],
        configuration: { timeoutMs: 150000 },
    };
    const result = buildFailureAudit(jobs, ledger);
    assert.equal(result.schemaVersion, AUDIT_SCHEMA);
    assert.deepEqual(result.eligibleWorkIds, ["sweep-001"]);
    assert.equal(result.failures[0].classification, "shared_hold_transport");
    assert.deepEqual(result.failures[0].causeWorkIds, ["sweep-002"]);
    assert.equal(result.failures[1].classification, "transport");
    assert.equal(result.summary.failed, 2);
    assert.equal(result.summary.unknownLedgerRequests, 1);
    assert.equal(result.perWave[0].primaryJobs, 2);
    assert.equal(
        result.cohortCapTabs.reduce((sum, row) => sum + row.failed, 0),
        2
    );
});

test("a sibling error without shared-hold evidence stays unknown", () => {
    const victim = job("sweep-001", {}, [
        { kind: "request" },
        { kind: "response", response: { toolCalls: [] } },
        { kind: "failure", code: "Error" },
    ]);
    const root = job("sweep-002", { durationMs: 100 });
    const result = classifyFailures([victim, root], [settled("sweep-001"), transport("sweep-002")]);
    assert.equal(result[0].classification, "unknown");
    const differentWave = classifyFailures(
        [job("sweep-001"), job("sweep-005", { durationMs: 100 })],
        [settled("sweep-001"), transport("sweep-005")]
    );
    assert.equal(differentWave[0].classification, "unknown");
});

test("HTTP status and timeout have explicit separate classifications", () => {
    const result = classifyFailures(
        [job("sweep-001"), job("sweep-002")],
        [
            { ...transport("sweep-001"), durationMs: 150000 },
            { workId: "sweep-002", status: "unknown", httpStatus: 429, durationMs: 40 },
        ]
    );
    assert.deepEqual(
        result.map(row => row.classification),
        ["timeout", "http_error"]
    );
    const audit = buildFailureAudit([job("sweep-002")], {
        records: [{ workId: "sweep-002", status: "unknown", httpStatus: 429 }],
    });
    assert.deepEqual(audit.summary.httpErrorsByStatus, { 429: 1 });
});

test("invalid and missing submission require surviving response evidence", () => {
    const invalid = job("sweep-001", {}, [
        { kind: "request" },
        { kind: "response", response: { toolCalls: [{ name: "submit_result" }] } },
        { kind: "tool_validation", name: "submit_result" },
        { kind: "failure", code: "AgentRunError" },
    ]);
    const missing = job("sweep-002", {}, [
        { kind: "request" },
        { kind: "response", response: { toolCalls: [] } },
        { kind: "failure", code: "AgentRunError" },
    ]);
    assert.deepEqual(
        classifyFailures([invalid, missing], []).map(row => row.classification),
        ["invalid_submission", "missing_submission"]
    );
});

test("projection emits no source, model response text or unknown error messages", () => {
    const marker = "PRIVATE_PAYLOAD_MUST_NOT_ESCAPE";
    const projected = job("sweep-001", {}, [
        {
            kind: "response",
            response: {
                text: marker,
                toolCalls: [{ name: "read_document_excerpt", arguments: { text: marker } }],
            },
        },
        { kind: "tool", content: marker },
        { kind: "failure", code: "contains raw source text! " + marker },
    ]);
    assert.equal(JSON.stringify(projected).includes(marker), false);
});
