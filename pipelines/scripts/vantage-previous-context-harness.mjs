/** Synthetic two-week reports. Rules by default; optional explicit live model; no dotenv/document/database access. */
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { createChatModelsConfig, resolveChatModel } from "@launchstack/llm";
import { generateWeeklyAgendaV1, GENERATION_BUDGETS } from "../src/vantage/generation-v1.ts";
import { assemblePreviousVantageContext } from "../src/vantage/previous-context-v1.ts";
import {
    eligibleInput,
    computeGenerationSignals,
    selectGenerationEvidence,
} from "../src/vantage/evidence-v1.ts";
import { validateGenerationResult } from "../src/vantage/validate-generation-v1.ts";

const fixtures = JSON.parse(
    await readFile(
        new URL("../../fixtures/vantage-previous-context/two-week.json", import.meta.url),
        "utf8"
    )
);
const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output");
const onlyIndex = args.indexOf("--only");
const only = onlyIndex < 0 ? null : args[onlyIndex + 1];
const live = args.includes("--live");
if (onlyIndex >= 0 && !only) throw new Error("--only requires a scenario ID.");
if (live && outputIndex < 0)
    throw new Error("Live evaluation requires --output with a new file path.");
let resolveModel = () => null;
if (live) {
    if (!process.env.CHAT_BASE_URL || !process.env.CHAT_API_KEY)
        throw new Error(
            "Live mode requires existing CHAT_BASE_URL and CHAT_API_KEY; no provider call was made."
        );
    const modelConfigPath = process.env.CHAT_MODELS_CONFIG;
    if (!modelConfigPath || !isAbsolute(modelConfigPath))
        throw new Error(
            "Live mode requires an explicit absolute CHAT_MODELS_CONFIG path; no provider call was made."
        );
    const config = createChatModelsConfig({
        yaml: await readFile(modelConfigPath, "utf8"),
        endpoint: { baseUrl: process.env.CHAT_BASE_URL, apiKey: process.env.CHAT_API_KEY },
    });
    resolveModel = () =>
        resolveChatModel({ config, route: "default", maxOutputTokens: 2400, timeoutMs: 20000 });
}
const historicalAction = () => ({
    id: fixtures.history.commitmentId,
    agendaId: fixtures.history.id,
    topicId: fixtures.history.topicId,
    topicTitle: fixtures.history.topicTitle,
    title: "Verify invoice export confirmation",
    owner: "Synthetic founder",
    dueOn: fixtures.history.proposedDue,
    test: "Five recorded confirmation checks",
    status: "open",
    outcome: null,
    shared: false,
    resolvedAt: null,
    createdAt: "2026-10-17T16:00:00.000Z",
});
function historicalReport(s) {
    const h = fixtures.history;
    const weekStart = s.historyWeekStart ?? h.weekStart;
    return {
        id: h.id,
        weekStart,
        weekEnd: weekStart === h.weekStart ? "2026-10-18" : "2026-10-25",
        status: "draft",
        summary: s.historySummary ?? h.summary,
        signals: null,
        modelMetadata: { mode: "ai", promptVersion: "synthetic-history" },
        generatedAt: h.generatedAt,
        heldAt: null,
        createdAt: "2026-10-17T14:00:00.000Z",
        topics: [
            {
                id: h.topicId,
                agendaId: h.id,
                position: 0,
                contentVersion: 2,
                status: "kept",
                origin: "ai",
                title: s.topicTitle ?? h.topicTitle,
                facts: [
                    {
                        text: h.sourceBody,
                        refs: [
                            {
                                ref: h.sourceRef,
                                label: "Synthetic previous-week note",
                                date: "2026-10-16",
                            },
                        ],
                    },
                ],
                whyItMatters: s.interpretation ?? h.interpretation,
                decisionQuestion: "What does invoice export confirmation require us to clarify?",
                proposedNextStep: s.proposedNextStep ?? h.proposedNextStep,
                proposedOwner: null,
                proposedDue: s.proposedDue ?? h.proposedDue,
                helpRequested: null,
                unknowns: ["Whether the earlier interpretation is correct."],
                conflicts: [],
                rationale: "Historical AI proposal, not current evidence.",
                shared: false,
                decision: s.decision === undefined ? h.decision : s.decision,
                decidedAt: s.decidedAt === undefined ? h.decidedAt : s.decidedAt,
                commitmentId: s.commitmentId === undefined ? h.commitmentId : s.commitmentId,
            },
        ],
        reportPeriod: {
            weekStart,
            timeZone: "America/New_York",
            startInclusive: weekStart + "T04:00:00.000Z",
            endExclusive:
                weekStart === h.weekStart ? "2026-10-19T04:00:00.000Z" : "2026-10-26T04:00:00.000Z",
            asOf: h.generatedAt,
            kind: "completed-week",
        },
        version: 3,
        enhancements: [],
        execution: null,
    };
}
const records = [];
for (const s of fixtures.scenarios.filter(s => !only || s.id === only)) {
    const report = s.noHistory ? null : historicalReport(s);
    const previous = assemblePreviousVantageContext({
        currentPeriod: fixtures.period,
        report,
        actions: s.commitmentId === null ? [] : [historicalAction()],
        sourceStates: [
            {
                ref: fixtures.history.sourceRef,
                status: s.sourceStatuses ? "missing-or-unauthorized" : "available",
                documentVerification: "not-applicable",
            },
        ],
    });
    const input = {
        contractVersion: "v1",
        runId: "synthetic-" + s.id,
        inputVersion: "synthetic-input-" + s.id,
        reportPeriod: structuredClone(fixtures.period),
        generationMode: live ? "configured-model" : "rules",
        data: {
            metricDefinitions: [],
            currentObservations: [],
            comparisonObservations: [],
            resolvedCommitments: [],
            carryForwardCommitments: s.currentActionStatus === "open" ? [historicalAction()] : [],
            currentEvidence:
                s.title && s.body
                    ? [
                          {
                              id: "ev-current-" + s.id,
                              kind: s.document ? "document" : "note",
                              title: s.title,
                              body: s.body,
                              source: "Synthetic current-week Vantage note",
                              sourceUrl: null,
                              observedAt: "2026-10-23",
                              visibility: "private",
                              tags: ["synthetic", "two-week"],
                              createdAt: "2026-10-23T17:00:00.000Z",
                          },
                      ]
                    : [],
        },
        reviewedTopics: [],
        previousVantageContext: previous,
    };
    const before = JSON.stringify(input);
    const eligible = eligibleInput(input);
    const { pack } = selectGenerationEvidence(eligible, computeGenerationSignals(eligible));
    const result = await generateWeeklyAgendaV1(input, {
        resolveModel,
        signal: new AbortController().signal,
        budgets: GENERATION_BUDGETS,
    });
    validateGenerationResult(input, structuredClone(result));
    const currentRefs = new Set(pack.items.map(i => i.ref));
    const unchanged = JSON.stringify(input) === before;
    const currentFactRefsOnly = result.draft.topics.every(t =>
        [...t.facts, ...t.conflicts].every(f => f.refs.every(r => currentRefs.has(r.ref)))
    );
    const oldStepNotCopied = result.draft.topics.every(
        t => t.proposedNextStep !== (s.proposedNextStep ?? fixtures.history.proposedNextStep)
    );
    const expectedMode = live && pack.items.length > 0 ? "ai" : "rules";
    const executionModePassed = result.execution.mode === expectedMode;
    if (!unchanged || !currentFactRefsOnly || !oldStepNotCopied || !executionModePassed)
        process.exitCode = 1;
    records.push({
        scenario: s.id,
        description: s.description,
        qualitativeExpectation: s.expected,
        historicalReportCandidate: report,
        currentInput: input,
        currentSelectedEvidence: pack.items,
        checks: {
            inputUnchanged: unchanged,
            currentFactRefsOnly,
            oldStepNotCopied,
            boundaryAccepted: true,
            expectedMode,
            executionModePassed,
        },
        result,
    });
    console.log(
        JSON.stringify({
            scenario: s.id,
            evidence: live ? "real-provider-attempt" : "deterministic-rules",
            mode: result.execution.mode,
            expectedMode,
            executionModePassed,
            outcome: result.execution.outcome,
            topics: result.draft.topics.length,
            enhancements: result.enhancements.length,
            summary: result.draft.summary,
            execution: result.execution,
            usage: result.draft.modelMetadata.usage,
        })
    );
}
if (!records.length) throw new Error("No matching synthetic scenario.");
if (outputIndex >= 0) {
    const destination = args[outputIndex + 1];
    if (!destination) throw new Error("--output requires a new file path.");
    await writeFile(
        destination,
        JSON.stringify(
            {
                observedAt: new Date().toISOString(),
                mode: live ? "live" : "deterministic-rules",
                evidenceClass:
                    "Observed generation results from synthetic fixtures; qualitative expectations are separate, and execution mode identifies AI versus Rules fallback",
                note: "No production data, dotenv loading or document retrieval. Default Rules mode makes no model call; --live uses only explicit process configuration. No automatic LLM semantic score is assigned. Race persistence rejection is exercised by repository integration tests, not this pure generation harness.",
                records,
            },
            null,
            2
        ) + "\n",
        { flag: "wx" }
    );
}
