// Offline historical diagnosis. Emit only allowlisted metadata, never model/source text.
import { readFile, readdir, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { externalOutput } from "./vantage-rag-multi-corpus-score.mjs";

export const AUDIT_SCHEMA = "vantage-budget-sweep-failure-audit/1";
const categories = [
    "transport",
    "shared_hold_transport",
    "timeout",
    "http_error",
    "invalid_submission",
    "missing_submission",
    "unknown",
];
const safeCode = value =>
    typeof value === "string" && /^[A-Za-z][A-Za-z0-9_:.-]{0,160}$/.test(value) ? value : null;
const finite = value =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const increment = (counts, key) => {
    counts[key] = (counts[key] ?? 0) + 1;
};
const counts = rows =>
    Object.fromEntries(
        categories.map(category => [
            category,
            rows.filter(row => row.classification === category).length,
        ])
    );
const waveOf = workId => Math.floor((Number(workId.slice(6)) - 1) / 4) + 1;

export function projectJob(entry) {
    const run = entry.primary;
    if (
        !run ||
        !/^sweep-\d{3}$/.test(entry.workId) ||
        entry.workId !== run.workId ||
        !["exploratory", "heldout"].includes(run.cohort) ||
        run.arm !== "configured-live" ||
        !["ok", "failed"].includes(run.status) ||
        !/^g[35]-[a-f0-9]{64}$/.test(run.caseId) ||
        ![8000, 16000, 32000, 80000].includes(run.retrievalLimits?.sharedEvidenceBytes)
    )
        throw new Error("FAILURE_AUDIT_JOB_INVALID");
    const events = entry.trace?.events ?? [];
    const responses = events.filter(event => event.kind === "response");
    const submitted = responses
        .flatMap(event => event.response?.toolCalls ?? [])
        .filter(call => call.name === "submit_result");
    const invalidSubmissions = events.filter(
        event =>
            event.kind === "tool_validation" &&
            [event.tool, event.name, event.toolName].includes("submit_result")
    ).length;
    return {
        workId: entry.workId,
        groupId: run.caseId,
        cohort: run.cohort,
        evidenceCapBytes: run.retrievalLimits?.sharedEvidenceBytes,
        arm: run.arm,
        status: run.status,
        failureCode: safeCode(run.failure),
        durationMs: finite(run.durationMs),
        explorationMs: finite(run.stageMs?.exploration),
        wave: waveOf(entry.workId),
        requests: events.filter(event => event.kind === "request").length,
        completedResponses: responses.length,
        submissionAttempts: submitted.length,
        invalidSubmissions,
        traceFailureCodes: events
            .filter(event => event.kind === "failure")
            .map(event => safeCode(event.code))
            .filter(Boolean),
        modelErrorCodes: events
            .filter(event => event.kind === "model_error")
            .map(event => safeCode(event.code ?? event.error?.code))
            .filter(Boolean),
    };
}

function timeoutEvidence(job, records, timeoutMs) {
    return (
        [
            job.failureCode,
            ...job.traceFailureCodes,
            ...job.modelErrorCodes,
            ...records.map(row => row.failure),
        ].some(code => typeof code === "string" && /(?:^|:)timeout$|deadline/i.test(code)) ||
        records.some(
            row =>
                row.status === "unknown" &&
                finite(row.durationMs) !== null &&
                row.durationMs >= timeoutMs
        )
    );
}

function directClassification(job, records, timeoutMs) {
    if (timeoutEvidence(job, records, timeoutMs)) return "timeout";
    if (
        records.some(
            row => row.httpStatus !== undefined && (row.httpStatus < 200 || row.httpStatus >= 300)
        )
    )
        return "http_error";
    const unresolved = records.filter(row => row.status === "unknown");
    if (
        unresolved.length &&
        unresolved.every(
            row =>
                row.httpStatus === undefined &&
                (row.continuedAfterTransportFailure ||
                    (row.scopedTransportFailure && row.failure === "no_http"))
        )
    )
        return "transport";
    return null;
}

export function classifyFailures(jobs, rawRecords, { timeoutMs = 150000 } = {}) {
    const records = rawRecords.map((row, index) => ({ ...row, ledgerOrdinal: index + 1 }));
    const perJob = new Map(
        jobs.map(job => [job.workId, records.filter(row => row.workId === job.workId)])
    );
    const results = jobs
        .filter(job => job.status === "failed")
        .map(job => ({
            ...job,
            classification: directClassification(job, perJob.get(job.workId), timeoutMs),
            causeWorkIds: [],
        }));
    for (const job of results) {
        if (job.classification) continue;
        const ownRecords = perJob.get(job.workId);
        const last = ownRecords.at(-1);
        const causes = results.filter(
            cause =>
                cause.wave === job.wave &&
                cause.classification === "transport" &&
                cause.durationMs !== null &&
                job.durationMs !== null &&
                cause.durationMs < job.durationMs
        );
        // The historical meter sets one global hold on a no-HTTP unknown. It
        // checks that hold after settling sibling HTTP responses, and clears it
        // only after Promise.allSettled for the four-wide wave. These surviving
        // signals distinguish a post-response hold from a missing submission.
        const heldAfterSettledResponse =
            last?.status === "settled" &&
            last.httpStatus >= 200 &&
            last.httpStatus < 300 &&
            job.requests === job.completedResponses + 1 &&
            job.traceFailureCodes.includes("Error") &&
            job.failureCode === "topic_exploration_failed:provider_or_submission";
        if (causes.length && heldAfterSettledResponse) {
            job.classification = "shared_hold_transport";
            job.causeWorkIds = causes.map(cause => cause.workId);
        } else if (job.invalidSubmissions && job.requests === job.completedResponses) {
            job.classification = "invalid_submission";
        } else if (
            job.requests === job.completedResponses &&
            job.requests > 0 &&
            job.submissionAttempts === 0 &&
            job.traceFailureCodes.some(code => /AgentRunError|submission|turn_limit/i.test(code))
        ) {
            job.classification = "missing_submission";
        } else job.classification = "unknown";
    }
    return results.map(job => {
        const own = perJob.get(job.workId);
        const last = own.at(-1);
        return {
            ...job,
            ledgerOrdinals: own.map(row => row.ledgerOrdinal),
            unknownLedgerOrdinals: own
                .filter(row => row.status === "unknown")
                .map(row => row.ledgerOrdinal),
            httpStatuses: [...new Set(own.map(row => row.httpStatus ?? null))],
            lastRequestDurationMs: finite(last?.durationMs),
            lastRequestStatus: last?.status ?? null,
            unknownRequests: own.filter(row => row.status === "unknown").length,
        };
    });
}

export function buildFailureAudit(jobs, ledger, bindings = {}) {
    if (new Set(jobs.map(job => job.workId)).size !== jobs.length)
        throw new Error("FAILURE_AUDIT_DUPLICATE_WORK");
    const failures = classifyFailures(jobs, ledger.records, {
        timeoutMs: ledger.configuration?.timeoutMs ?? 150000,
    });
    const byWork = new Map(failures.map(job => [job.workId, job]));
    const unknownRequests = ledger.records.flatMap((row, index) =>
        row.status !== "unknown"
            ? []
            : [
                  {
                      ledgerOrdinal: index + 1,
                      workId: /^sweep-\d{3}$/.test(row.workId) ? row.workId : null,
                      durationMs: finite(row.durationMs),
                      httpStatus: row.httpStatus ?? null,
                      continuedAfterTransportFailure: row.continuedAfterTransportFailure === true,
                      classification: byWork.get(row.workId)?.classification ?? "unknown",
                  },
              ]
    );
    const eligibleJobs = failures
        .filter(
            job =>
                job.cohort === "heldout" &&
                job.evidenceCapBytes === 16000 &&
                ["transport", "shared_hold_transport"].includes(job.classification)
        )
        .map(job => ({
            workId: job.workId,
            groupId: job.groupId,
            evidenceCapBytes: 16000,
            classification: job.classification,
            causeWorkIds: job.causeWorkIds,
        }));
    const perWave = [...new Set(jobs.map(job => job.wave))]
        .sort((a, b) => a - b)
        .map(wave => {
            const members = jobs.filter(job => job.wave === wave);
            const failed = failures.filter(job => job.wave === wave);
            return {
                wave,
                workIds: members.map(job => job.workId),
                primaryJobs: members.length,
                successful: members.filter(job => job.status === "ok").length,
                failed: failed.length,
                classifications: counts(failed),
                unknownRequests: failed.reduce((sum, job) => sum + job.unknownRequests, 0),
                relativeRunCompletion: members
                    .map(job => ({
                        workId: job.workId,
                        durationMs: job.durationMs,
                        status: job.status,
                    }))
                    .sort((a, b) => (a.durationMs ?? Infinity) - (b.durationMs ?? Infinity)),
                transportCauseWorkIds: failed
                    .filter(job => job.classification === "transport")
                    .map(job => job.workId),
            };
        });
    const tabs = [];
    for (const cohort of ["exploratory", "heldout"]) {
        for (const cap of [
            ...new Set(jobs.filter(job => job.cohort === cohort).map(job => job.evidenceCapBytes)),
        ].sort((a, b) => a - b)) {
            const members = jobs.filter(
                job => job.cohort === cohort && job.evidenceCapBytes === cap
            );
            const failed = failures.filter(
                job => job.cohort === cohort && job.evidenceCapBytes === cap
            );
            tabs.push({
                cohort,
                evidenceCapBytes: cap,
                primaryJobs: members.length,
                successful: members.length - failed.length,
                failed: failed.length,
                classifications: counts(failed),
            });
        }
    }
    const httpErrorsByStatus = {};
    for (const row of ledger.records)
        if (row.httpStatus !== undefined && (row.httpStatus < 200 || row.httpStatus >= 300))
            increment(httpErrorsByStatus, row.httpStatus);
    return {
        schemaVersion: AUDIT_SCHEMA,
        ...bindings,
        method: {
            waveWidth: 4,
            transport:
                "Unknown no-HTTP request acknowledged continuedAfterTransportFailure; timeout evidence takes precedence.",
            cascade:
                "Same four-wide wave has an earlier-duration transport root; victim settled a 2xx request, has one unmatched trace request, and terminated with generic Error while the historical shared hold remained until wave completion.",
            chronologyLimit:
                "The archive retains ledger dispatch order and relative run/request durations, not absolute completion timestamps. Cascade diagnosis combines these with historical meter control flow; it does not infer provider response content.",
            billing:
                "Unknown usage remains unknown and reserved. Operational classification does not settle charges.",
        },
        summary: {
            primaryJobs: jobs.length,
            successful: jobs.length - failures.length,
            failed: failures.length,
            classifications: counts(failures),
            ledgerRecords: ledger.records.length,
            unknownLedgerRequests: unknownRequests.length,
            unknownRequestWorkIds: new Set(unknownRequests.map(row => row.workId)).size,
            unknownRequestsLinkedToFailedJobs: unknownRequests.filter(row => byWork.has(row.workId))
                .length,
            httpErrorsByStatus,
            eligibleHeldout16KB: eligibleJobs.length,
        },
        cohortCapTabs: tabs,
        perWave,
        failures,
        unknownRequests,
        eligibleWorkIds: eligibleJobs.map(job => job.workId),
        eligibleJobs,
    };
}

export async function main(args = process.argv.slice(2)) {
    const { values } = parseArgs({
        args,
        options: {
            evidence: { type: "string" },
            capture: { type: "string" },
            output: { type: "string" },
        },
    });
    if (!values.evidence || !values.output) throw new Error("FAILURE_AUDIT_ARGUMENTS_REQUIRED");
    const evidence = await realpath(values.evidence);
    const capturePath = values.capture ?? evidence.replace(/\.evidence$/, ".json");
    const captureBytes = await readFile(capturePath);
    const capture = JSON.parse(captureBytes.toString("utf8"));
    const ledgerBytes = await readFile(resolve(evidence, "usage-ledger.json"));
    const ledger = JSON.parse(ledgerBytes.toString("utf8"));
    const names = (await readdir(evidence)).filter(name => /^sweep-\d{3}\.json$/.test(name)).sort();
    const jobs = [];
    for (const name of names)
        jobs.push(projectJob(JSON.parse(await readFile(resolve(evidence, name), "utf8"))));
    const original = capture.filter(row => row.arm === "configured-live");
    if (
        original.length !== jobs.length ||
        jobs.some(
            job =>
                !original.some(
                    row =>
                        row.workId === job.workId &&
                        row.caseId === job.groupId &&
                        row.status === job.status &&
                        row.cohort === job.cohort &&
                        row.retrievalLimits?.sharedEvidenceBytes === job.evidenceCapBytes
                )
        )
    )
        throw new Error("FAILURE_AUDIT_CAPTURE_MISMATCH");
    const captureSha256 = sha256(captureBytes);
    const audit = buildFailureAudit(jobs, ledger, {
        captureSha256,
        originalArchiveSha256: captureSha256,
        ledgerSha256: sha256(ledgerBytes),
    });
    await externalOutput(values.output, audit);
    console.log(
        JSON.stringify({
            schemaVersion: AUDIT_SCHEMA,
            captureSha256,
            ledgerSha256: audit.ledgerSha256,
            ...audit.summary,
        })
    );
    return audit;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main().catch(error => {
        console.error(
            /^FAILURE_AUDIT_[A-Z_]+$/.test(error.message) ? error.message : "FAILURE_AUDIT_FAILED"
        );
        process.exitCode = 1;
    });
