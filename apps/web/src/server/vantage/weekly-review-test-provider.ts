import { coerceMessageLikeToMessage } from "@langchain/core/messages";
import type { invokeStructuredAttempt, ResolvedChatModel } from "@launchstack/llm";
import type {
    WeeklyReviewInput,
    WeeklyReviewV21,
} from "@launchstack/pipelines/vantage/weekly-review-v21";
import {
    RATED_CRITERIA,
    type ValidationJudge,
} from "@launchstack/pipelines/vantage/weekly-review-validation";
export function weeklyReviewTestPorts(input: WeeklyReviewInput) {
    if (process.env.VANTAGE_WEEKLY_REVIEW_TEST_PROVIDER !== "true") return null;
    if (
        process.env.NODE_ENV === "production" ||
        process.env.DATABASE_URL !==
            "postgres://postgres:vantage_port_disposable@127.0.0.1:55439/vantage_port"
    )
        throw Error("test_provider_not_allowed");
    const model = (id: string) =>
        ({
            modelId: id,
            behavior: { parameters: { systemMessages: "supported" } },
            prepareMessages: (messages: Parameters<ResolvedChatModel["prepareMessages"]>[0]) =>
                messages.map(coerceMessageLikeToMessage),
        }) as ResolvedChatModel;
    const report: WeeklyReviewV21 = {
        schemaVersion: "vantage-weekly-review/v2.1",
        headline: "Review current company evidence",
        brief: "Injected deterministic engineering acceptance.",
        summary: "Review the supplied company evidence before recording a human decision.",
        keyFigures: [],
        topics: [
            {
                title: "Review the company context",
                facts: input.sources.slice(0, 6).map(source => ({
                    text: source.text
                        .trimStart()
                        .slice(0, 500)
                        .replace(/[\uD800-\uDBFF]$/, ""),
                    refs: [source.ref],
                })),
                conflicts: [],
                whyItMatters: "Interpret the supplied context before choosing a next step.",
                whyNow: "This reporting period requires a human review.",
                decisionQuestion: "What further evidence is needed?",
                rationale: "The required context is available for review.",
                recommendation: null,
                proposedNextStep: "Record a human decision and identify any missing evidence.",
                unknowns: ["Execution has not been independently verified."],
                proposedOwner: null,
                proposedDue: null,
                helpRequested: null,
            },
        ],
    };
    // Internal/scoped selection guarantees this useful reserve, not a fixed
    // character count. Include JSON escaping, refs and all report fields in it.
    const facts = report.topics[0]!.facts;
    while (Buffer.byteLength(JSON.stringify(report), "utf8") > 2800) {
        const longest = facts
            .filter(fact => Array.from(fact.text).length > 1)
            .sort(
                (a, b) =>
                    Buffer.byteLength(JSON.stringify(b.text)) -
                    Buffer.byteLength(JSON.stringify(a.text))
            )[0];
        if (longest) longest.text = Array.from(longest.text).slice(0, -1).join("");
        // Unusually large citation metadata may require fewer facts.
        else if (facts.length > 1) facts.pop();
        else throw Error("test_provider_report_unavailable");
    }
    const validationJudge: ValidationJudge = {
        kind: "fixture-replay",
        id: "synthetic-http-acceptance-judge",
        async evaluate(request) {
            const source = request.input.scenario.documents[0]!,
                output = request.outputUnits[0]!;
            const evidence = [
                { kind: "source" as const, id: source.id, quote: source.text.slice(0, 50) },
                { kind: "output" as const, id: output.id, quote: output.text.slice(0, 50) },
            ];
            return {
                judgment: {
                    expectations: request.input.scenario.expectations.map(item => ({
                        expectationId: item.id,
                        verdict: "met",
                        reason: "Deterministic engineering fixture; not semantic quality evidence.",
                        evidence: [
                            {
                                kind: "source",
                                id: item.evidence[0]!.sourceId,
                                quote: item.evidence[0]!.quote,
                            },
                            { kind: "output", id: output.id, quote: output.text.slice(0, 50) },
                        ],
                    })),
                    ratings: RATED_CRITERIA.map(criterion => ({
                        criterion,
                        score: 4,
                        reason: "Deterministic engineering fixture.",
                        evidence,
                    })),
                },
            };
        },
    };
    return {
        generation: model("synthetic-generation"),
        judge: model("synthetic-judge"),
        validationJudge,
        invoke: (async () => ({
            result: report,
            usage: { outputTokens: 100 },
        })) as typeof invokeStructuredAttempt,
    };
}
