import {
    CRITERIA,
    EVALUATION_VERSION,
    RUBRIC_VERSION,
    JudgmentSchema,
    RATED_CRITERIA,
    type EvaluationInput,
    type EvaluationReport,
    type IntegrityIssue,
    type Judgment,
    type MetricResult,
    type ValidationJudge,
} from "./contracts";
import { fingerprint, outputUnits, parseEvaluationInput } from "./input";

export function checkOutputIntegrity(input: EvaluationInput): IntegrityIssue[] {
    const docs = new Map(input.scenario.documents.map(doc => [doc.id, doc]));
    const issues: IntegrityIssue[] = [];
    for (const unit of outputUnits(input)) {
        if (unit.unsupported)
            issues.push({ code: "marked-unsupported", severity: "error", outputId: unit.id });
        if (
            (/\/(fact|conflict)\/\d+$/.test(unit.id) ||
                /^enhancement\/.+\/evidence$/.test(unit.id)) &&
            !unit.sourceIds.length
        )
            issues.push({ code: "uncited-fact", severity: "error", outputId: unit.id });
        for (const sourceId of new Set(unit.sourceIds)) {
            const doc = docs.get(sourceId);
            if (!doc)
                issues.push({
                    code: "unknown-citation",
                    severity: "error",
                    outputId: unit.id,
                    sourceId,
                });
            else if (Date.parse(doc.availableAt) > Date.parse(input.scenario.asOf))
                issues.push({
                    code: "future-citation",
                    severity: "error",
                    outputId: unit.id,
                    sourceId,
                });
        }
    }
    if (
        !input.actual.summary.trim() &&
        !input.actual.tasks.length &&
        !input.actual.enhancements.length
    )
        issues.push({ code: "empty-output", severity: "error", outputId: "summary" });
    const seen = new Set<string>();
    for (const task of input.actual.tasks) {
        const identity = `${task.title.trim().toLowerCase()}\n${task.nextStep.trim().toLowerCase()}`;
        if (seen.has(identity))
            issues.push({
                code: "duplicate-task",
                severity: "warning",
                outputId: `task/${task.id}/title`,
            });
        seen.add(identity);
    }
    return issues;
}

/** Validate evidence locations/quotes and exhaustive coverage; model judgment itself remains fallible. */
export function validateJudgment(raw: unknown, input: EvaluationInput): Judgment {
    const parsed = JudgmentSchema.safeParse(raw);
    if (!parsed.success) throw new Error("Invalid judgment schema.");
    const judgment = parsed.data;
    const expectations = new Map(input.scenario.expectations.map(item => [item.id, item]));
    if (
        judgment.expectations.length !== expectations.size ||
        new Set(judgment.expectations.map(item => item.expectationId)).size !== expectations.size ||
        new Set(judgment.ratings.map(item => item.criterion)).size !== RATED_CRITERIA.length
    )
        throw new Error("Judgment must assess every expectation and criterion exactly once.");
    const sources = new Map(input.scenario.documents.map(doc => [doc.id, doc.text]));
    const outputs = new Map(outputUnits(input).map(unit => [unit.id, unit.text]));
    for (const assessment of [...judgment.expectations, ...judgment.ratings]) {
        for (const citation of assessment.evidence) {
            const text = (citation.kind === "source" ? sources : outputs).get(citation.id);
            if (!text?.includes(citation.quote))
                throw new Error("Judge evidence does not match supplied text.");
        }
    }
    for (const item of judgment.expectations) {
        const expected = expectations.get(item.expectationId);
        if (
            !expected ||
            (expected.kind === "must_include" && item.verdict === "violated") ||
            (expected.kind === "must_not_claim" && ["partial", "missed"].includes(item.verdict))
        )
            throw new Error("Judgment expectation verdict is invalid.");
        if (
            !item.evidence.some(
                citation =>
                    citation.kind === "source" &&
                    expected.evidence.some(ref => ref.sourceId === citation.id)
            )
        )
            throw new Error("Expectation assessment needs source evidence.");
        if (
            ((expected.kind === "must_include" && ["met", "partial"].includes(item.verdict)) ||
                item.verdict === "violated") &&
            !item.evidence.some(citation => citation.kind === "output")
        )
            throw new Error("A claimed output match or violation requires an exact output quote.");
    }
    for (const rating of judgment.ratings) {
        if (rating.score !== null && !rating.evidence.some(citation => citation.kind === "output"))
            throw new Error("A numeric rating requires output evidence.");
        if (
            rating.score !== null &&
            ["grounding", "temporal"].includes(rating.criterion) &&
            !rating.evidence.some(citation => citation.kind === "source")
        )
            throw new Error("Grounding and temporal ratings require source evidence.");
    }
    return judgment;
}

const importance = { normal: 1, important: 2, critical: 3 };
function metrics(
    input: EvaluationInput,
    judgment: Judgment,
    issues: IntegrityIssue[]
): MetricResult[] {
    const weights = new Map(
        input.scenario.expectations.map(item => [item.id, importance[item.importance]])
    );
    const total = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
    const covered = judgment.expectations.reduce(
        (sum, item) =>
            sum +
            (item.verdict === "met" ? 1 : item.verdict === "partial" ? 0.5 : 0) *
                weights.get(item.expectationId)!,
        0
    );
    return CRITERIA.map(criterion => {
        if (criterion === "coverage")
            return {
                criterion,
                score: judgment.expectations.some(item => item.verdict === "uncertain")
                    ? null
                    : Math.round((100 * covered) / total),
                method: "weighted-expectations",
                reason: "Weighted semantic expectation coverage: normal=1, important=2, critical=3; met=1, partial=0.5, missed/violated=0. Uncertain leaves coverage unassessed.",
                evidence: [],
            };
        const rating = judgment.ratings.find(item => item.criterion === criterion)!;
        const cap = issues.some(
            issue =>
                issue.severity === "error" &&
                ((criterion === "grounding" &&
                    ["unknown-citation", "uncited-fact", "marked-unsupported"].includes(
                        issue.code
                    )) ||
                    (criterion === "temporal" && issue.code === "future-citation"))
        );
        return {
            criterion,
            score: rating.score === null ? null : cap ? 0 : rating.score * 25,
            method: cap ? "judge+integrity" : "judge",
            reason: cap
                ? `${rating.reason} Deterministic citation errors cap this criterion at zero; see integrityIssues.`
                : rating.reason,
            evidence: rating.evidence,
        };
    });
}

/** Read-only assessor. No tools, no generator registration, no persistence, and no automatic retry. */
export async function evaluateVantage(
    raw: unknown,
    options: {
        judge?: ValidationJudge;
        signal?: AbortSignal;
        timeoutMs?: number;
    } = {}
): Promise<EvaluationReport> {
    const input = parseEvaluationInput(raw);
    const timeoutMs = options.timeoutMs ?? 25000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
        throw new Error("Invalid evaluator timeout.");
    const started = performance.now();
    const issues = checkOutputIntegrity(input);
    const report: EvaluationReport = {
        version: EVALUATION_VERSION,
        rubricVersion: RUBRIC_VERSION,
        scenarioId: input.scenario.id,
        scenarioVersion: input.scenario.version,
        scenarioFingerprint: fingerprint(input.scenario),
        inputFingerprint: fingerprint(input),
        candidateId: input.actual.id,
        pipelineVersion: input.actual.pipelineVersion,
        contextCompleteness: input.scenario.contextCompleteness,
        judge: { kind: options.judge?.kind ?? "none", id: options.judge?.id ?? null },
        status: "unavailable",
        verdict: issues.some(issue => issue.severity === "error") ? "fail" : "needs-review",
        metrics: CRITERIA.map(criterion => ({
            criterion,
            score: null,
            method: criterion === "coverage" ? "weighted-expectations" : "judge",
            reason: "No valid semantic assessment is available.",
            evidence: [],
        })),
        expectations: input.scenario.expectations.map(item => ({
            expectationId: item.id,
            verdict: "unassessed",
            reason: "No valid semantic assessment is available.",
            evidence: [],
        })),
        integrityIssues: issues,
        overallScore: null,
        error: "no-judge",
        usage: null,
        durationMs: 0,
    };
    if (!options.judge) return report;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    let timedOut = false;
    try {
        const deadline = new Promise<never>((_, reject) => {
            const stop = () => {
                controller.abort();
                reject(new Error("deadline"));
            };
            onAbort = stop;
            if (options.signal?.aborted) stop();
            else options.signal?.addEventListener("abort", stop, { once: true });
            timer = setTimeout(() => {
                timedOut = true;
                stop();
            }, timeoutMs);
        });
        const answer = await Promise.race([
            deadline,
            Promise.resolve().then(() => {
                if (controller.signal.aborted) throw new Error("cancelled");
                return options.judge!.evaluate(
                    {
                        rubricVersion: RUBRIC_VERSION,
                        input: structuredClone(input),
                        outputUnits: outputUnits(input),
                    },
                    controller.signal
                );
            }),
        ]);
        if (answer.usage) {
            report.usage = {};
            for (const key of [
                "inputTokens",
                "outputTokens",
                "totalTokens",
                "reasoningTokens",
            ] as const) {
                const count = answer.usage[key];
                if (typeof count === "number" && Number.isFinite(count) && count >= 0)
                    report.usage[key] = count;
            }
        }
        let judgment: Judgment;
        try {
            judgment = validateJudgment(answer.judgment, input);
        } catch {
            report.error = "invalid-judgment";
            return report;
        }
        report.metrics = metrics(input, judgment, issues);
        report.expectations = judgment.expectations;
        report.error = null;
        const complete = report.metrics.every(metric => metric.score !== null);
        report.status = complete ? "assessed" : "partial";
        report.overallScore = complete
            ? Math.round(
                  report.metrics.reduce((sum, metric) => sum + metric.score!, 0) / CRITERIA.length
              )
            : null;
        const criticalMiss = input.scenario.expectations.some(
            expected =>
                expected.importance === "critical" &&
                ["partial", "missed", "violated"].includes(
                    judgment.expectations.find(item => item.expectationId === expected.id)!.verdict
                )
        );
        const failed =
            issues.some(issue => issue.severity === "error") ||
            criticalMiss ||
            report.metrics.some(
                metric =>
                    metric.score !== null &&
                    metric.score < (metric.criterion === "coverage" ? 80 : 75)
            );
        report.verdict = failed
            ? "fail"
            : complete && input.scenario.contextCompleteness === "complete"
              ? "pass"
              : "needs-review";
        return report;
    } catch (error) {
        const name = error instanceof Error ? error.name : "";
        report.error = options.signal?.aborted
            ? "cancelled"
            : timedOut
              ? "timeout"
              : name === "InvalidStructuredAttemptError"
                ? "invalid-judgment"
                : name === "StructuredAttemptSetupError"
                  ? "judge-setup"
                  : "provider-error";
        return report;
    } finally {
        clearTimeout(timer);
        if (onAbort) options.signal?.removeEventListener("abort", onAbort);
        controller.abort();
        report.durationMs = Math.round(performance.now() - started);
    }
}
