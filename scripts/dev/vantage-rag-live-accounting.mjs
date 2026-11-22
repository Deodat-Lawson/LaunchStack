// Evaluator-only aggregate reader. Never import from retrieval or provider code.
import { readFile, realpath, readdir } from "node:fs/promises";
import { resolve, relative, isAbsolute, dirname, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../../", import.meta.url));
const tools = new Set([
    "get_personal_topic",
    "get_document_digest",
    "read_document_excerpt",
    "submit_result",
]);
const resultCodes = new Set(["not_offered", "range_invalid", "not_readable", "result_too_large"]);
const stages = ["setup", "collect", "reserve", "digest", "exploration", "freeze", "finalize"];
const statuses = new Set(["reserved", "sent", "settled", "unknown", "released"]);
const number = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
const sum = values => values.reduce((a, b) => a + b, 0);
const round = value => Math.round(value * 1e9) / 1e9;
const code = value =>
    typeof value === "string" && /^[A-Za-z][A-Za-z0-9_:]{0,100}$/.test(value)
        ? value
        : "unclassified";
const increment = (counts, key) => {
    counts[key] = (counts[key] ?? 0) + 1;
};
export function latency(values) {
    const sorted = values.filter(number).sort((a, b) => a - b);
    if (!sorted.length) return { n: 0, min: null, median: null, p95: null, max: null };
    const middle = Math.floor(sorted.length / 2);
    return {
        n: sorted.length,
        min: sorted[0],
        median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
        p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
        max: sorted.at(-1),
    };
}
function inside(parent, child) {
    const part = relative(parent, child);
    return !isAbsolute(part) && part !== ".." && !part.startsWith(".." + sep);
}
export async function liveAccounting(capture) {
    const mainPath = await realpath(capture);
    if (inside(await realpath(root), mainPath))
        throw new Error("accounting_capture_must_be_external");
    const directory = await realpath(mainPath.replace(/\.json$/, ".evidence"));
    if (directory === mainPath || !inside(dirname(mainPath), directory))
        throw new Error("accounting_evidence_path_invalid");
    const files = [];
    async function json(path) {
        const actual = await realpath(path);
        if (!inside(dirname(mainPath), actual)) throw new Error("accounting_file_escape");
        const bytes = await readFile(actual);
        files.push({
            name: path === mainPath ? "capture.json" : path.slice(directory.length + 1),
            bytes: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
        });
        return JSON.parse(bytes.toString("utf8"));
    }
    const results = await json(mainPath);
    if (!Array.isArray(results)) throw new Error("accounting_capture_invalid");
    const cases = [];
    const names = (await readdir(directory)).filter(name => /^case-\d{2}\.json$/.test(name)).sort();
    for (const name of names) cases.push(await json(resolve(directory, name)));
    const digests = await json(resolve(directory, "digests.json"));
    const ledger = await json(resolve(directory, "usage-ledger.json"));
    if (!Array.isArray(digests) || !Array.isArray(ledger.records))
        throw new Error("accounting_evidence_invalid");
    const failureCodes = {},
        traceFailures = {},
        toolResults = {},
        requestedTools = {};
    let toolResultHashMismatches = 0,
        missingTraceCases = 0;
    for (const entry of cases) {
        if (entry.failure) increment(failureCodes, code(entry.failure));
        if (!entry.trace) missingTraceCases++;
        for (const event of entry.trace?.events ?? []) {
            if (event.kind === "failure") increment(traceFailures, code(event.code));
            if (event.kind === "response")
                for (const call of event.response?.toolCalls ?? [])
                    increment(requestedTools, tools.has(call.name) ? call.name : "unknown_tool");
            if (event.kind !== "tool") continue;
            const name = tools.has(event.name) ? event.name : "unknown_tool";
            let result = "success";
            try {
                const content = JSON.parse(event.content);
                if (content.error)
                    result = resultCodes.has(content.error) ? content.error : "other_error";
                else if (name === "get_document_digest" && !content.digest)
                    result = "digest_unavailable";
            } catch {
                result = "invalid_json";
            }
            increment(toolResults, name + "/" + result);
            if (
                typeof event.content !== "string" ||
                createHash("sha256").update(JSON.stringify(event.content)).digest("hex") !==
                    event.resultHash
            )
                toolResultHashMismatches++;
        }
    }
    const nativeTokens = {};
    for (const field of [
        "inputTokens",
        "outputTokens",
        "cachedInputTokens",
        "cacheWriteTokens",
        "reasoningTokens",
    ])
        nativeTokens[field] = {
            reportedRequests: ledger.records.filter(row => number(row[field])).length,
            total: sum(ledger.records.map(row => (number(row[field]) ? row[field] : 0))),
        };
    const byRoute = {},
        requestStatuses = {},
        requestFailureCodes = {};
    let inferredLegacyRoutes = 0;
    const records = ledger.records.map((row, index) => {
        if (!statuses.has(row.status)) throw new Error("accounting_ledger_status_invalid");
        let route = ["digest", "exploration"].includes(row.route) ? row.route : "unclassified";
        // Only case 1 predates explicit route metadata. Its recorded prefix is digests.
        const first = cases[0];
        if (
            route === "unclassified" &&
            names[0] === "case-01.json" &&
            index >= first.ledgerStart &&
            index < first.ledgerEnd
        ) {
            route =
                index - first.ledgerStart < first.accounting.digestProviderCalls
                    ? "digest"
                    : "exploration";
            inferredLegacyRoutes++;
        }
        increment(requestStatuses, row.status);
        if (row.failure) increment(requestFailureCodes, code(row.failure));
        const aggregate = (byRoute[route] ??= { modelCalls: 0, statuses: {}, durations: [] });
        if (["sent", "settled", "unknown"].includes(row.status)) aggregate.modelCalls++;
        increment(aggregate.statuses, row.status);
        if (number(row.durationMs)) aggregate.durations.push(row.durationMs);
        return row;
    });
    for (const aggregate of Object.values(byRoute)) {
        aggregate.requestLatencyMs = latency(aggregate.durations);
        delete aggregate.durations;
    }
    const unsettled = records.filter(row => ["reserved", "sent", "unknown"].includes(row.status));
    const conservativeSettled = sum(
        records.map(row => (number(row.settledListRateUsd) ? row.settledListRateUsd : 0))
    );
    const globalRows = records.filter(row => number(row.globalShortListRateUsd));
    const globalSettled = sum(globalRows.map(row => row.globalShortListRateUsd));
    const fullReservations = sum(unsettled.map(row => row.projectedUsd));
    const issues = [];
    if (cases.length !== results.length) issues.push("checkpoint_capture_count_mismatch");
    let lastEnd = 0;
    for (const [index, entry] of cases.entries()) {
        if (
            !results[index] ||
            Object.entries(results[index]).some(
                ([key, value]) => JSON.stringify(entry[key]) !== JSON.stringify(value)
            )
        )
            issues.push("checkpoint_capture_mismatch");
        if (
            entry.ledgerStart !== lastEnd ||
            !Number.isSafeInteger(entry.ledgerEnd) ||
            entry.ledgerEnd < lastEnd ||
            entry.ledgerEnd > records.length
        )
            issues.push("checkpoint_ledger_range_invalid");
        lastEnd = entry.ledgerEnd;
    }
    if (new Set(records.map(row => row.id)).size !== records.length)
        issues.push("duplicate_ledger_id");
    if (toolResultHashMismatches) issues.push("tool_result_hash_mismatch");
    if (Math.abs(conservativeSettled - ledger.settledListRateUsd) > 1e-6)
        issues.push("settled_total_mismatch");
    if (Math.abs(fullReservations - ledger.reservedUsd) > 1e-6)
        issues.push("reservation_total_mismatch");
    return {
        schemaVersion: "vantage-rag-live-accounting/1",
        complete: results.length === 20,
        cases: {
            captured: results.length,
            checkpoints: cases.length,
            successful: results.filter(row => row.status === "ok").length,
            failed: results.filter(row => row.status === "failed").length,
            failureCodes,
            traceFailures,
            missingTraceCases,
        },
        latencyMs: {
            basis: "Observed elapsed time, including terminal timeout intervals; p95 uses nearest rank",
            caseTotal: latency(results.map(row => row.durationMs)),
            stages: Object.fromEntries(
                stages.map(stage => [stage, latency(cases.map(row => row.stageMs?.[stage]))])
            ),
        },
        calls: {
            byRoute,
            requestStatuses,
            requestFailureCodes,
            inferredLegacyRoutes,
            records: records.length,
            recordsAfterLastCheckpoint: records.length - lastEnd,
        },
        nativeTokens,
        costs: {
            basis: "Azure list-rate estimates from native usage; invoice billing unverified",
            pricingSource: /^https:\/\/azure\.microsoft\.com\//.test(ledger.pricingSource)
                ? ledger.pricingSource
                : null,
            conservativeRatesUsdPerToken: Object.fromEntries(
                [
                    "promptUsdPerToken",
                    "completionUsdPerToken",
                    "cachedPromptUsdPerToken",
                    "cacheWriteUsdPerToken",
                ].map(key => [
                    key,
                    number(ledger.configuration?.[key]) ? ledger.configuration[key] : null,
                ])
            ),
            globalStandardRatesUsdPerMillion: { input: 0.1, cachedInput: 0.01, output: 0.5 },
            conservativeSettledUsd: round(conservativeSettled),
            globalStandardSettledUsd: round(globalSettled),
            globalStandardPricedRequests: globalRows.length,
            fullUnknownReservationsUsd: round(
                sum(records.filter(row => row.status === "unknown").map(row => row.projectedUsd))
            ),
            fullOpenReservationsUsd: round(fullReservations),
            conservativeTotalIncludingReservationsUsd: round(
                conservativeSettled + fullReservations
            ),
            globalStandardTotalWithConservativeReservationsUsd: round(
                globalSettled + fullReservations
            ),
            limitUsd: ledger.limitUsd,
            hold: ledger.hold ? code(ledger.hold) : null,
        },
        tools: { requestedByName: requestedTools, executedByNameAndResult: toolResults },
        integrity: {
            issues: [...new Set(issues)],
            toolResultHashMismatches,
            digestRows: digests.length,
            uniqueDigestIds: new Set(digests.map(row => row.id)).size,
            filesRead: files.length,
            files,
        },
    };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    liveAccounting(process.argv[2])
        .then(result => console.log(JSON.stringify(result, null, 2)))
        .catch(() => {
            console.error("live_accounting_failed");
            process.exitCode = 1;
        });
}
