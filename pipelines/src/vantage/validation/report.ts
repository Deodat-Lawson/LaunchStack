import { CRITERIA, RUBRIC_VERSION, type EvaluationReport } from "./contracts";

export function aggregateEvaluations(reports: readonly EvaluationReport[]) {
    if (!reports.length) throw new Error("Cannot aggregate an empty benchmark.");
    if (new Set(reports.map(report => report.pipelineVersion)).size !== 1)
        throw new Error("Aggregate each pipeline version separately, then use paired comparison.");
    if (
        new Set(reports.map(report => `${report.scenarioId}/${report.candidateId}`)).size !==
        reports.length
    )
        throw new Error("Duplicate scenario/candidate results would distort the benchmark.");
    if (
        new Set(
            reports.map(report => `${report.rubricVersion}/${report.judge.kind}/${report.judge.id}`)
        ).size !== 1
    )
        throw new Error("Do not aggregate different rubrics or judges as a comparable benchmark.");
    return {
        rubricVersion: RUBRIC_VERSION,
        pipelineVersion: reports[0]!.pipelineVersion,
        judge: reports[0]!.judge,
        total: reports.length,
        assessed: reports.filter(report => report.status === "assessed").length,
        passed: reports.filter(report => report.verdict === "pass").length,
        failed: reports.filter(report => report.verdict === "fail").length,
        needsReview: reports.filter(report => report.verdict === "needs-review").length,
        metrics: CRITERIA.map(criterion => {
            const scores = reports
                .map(report => report.metrics.find(metric => metric.criterion === criterion)?.score)
                .filter((score): score is number => typeof score === "number");
            return {
                criterion,
                mean: scores.length
                    ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
                    : null,
                assessedCount: scores.length,
                totalCount: reports.length,
            };
        }),
        overallMean: reports.every(report => report.overallScore !== null)
            ? Math.round(
                  reports.reduce((sum, report) => sum + report.overallScore!, 0) / reports.length
              )
            : null,
    };
}

/** Paired comparisons require the same exact source/expectation set and judge identity. */
export function compareEvaluations(
    baseline: readonly EvaluationReport[],
    candidate: readonly EvaluationReport[]
) {
    if (
        !baseline.length ||
        baseline.length !== candidate.length ||
        new Set(baseline.map(report => report.scenarioId)).size !== baseline.length ||
        new Set(candidate.map(report => report.scenarioId)).size !== candidate.length
    )
        throw new Error("Comparison requires one result per scenario in matching suites.");
    return baseline.map(before => {
        const after = candidate.find(report => report.scenarioId === before.scenarioId);
        if (
            !after ||
            before.scenarioFingerprint !== after.scenarioFingerprint ||
            before.rubricVersion !== after.rubricVersion ||
            before.judge.id !== after.judge.id ||
            before.judge.kind !== after.judge.kind
        )
            throw new Error("Comparison requires unchanged scenarios, rubrics and judges.");
        return {
            scenarioId: before.scenarioId,
            baseline: before.candidateId,
            candidate: after.candidateId,
            baselineVerdict: before.verdict,
            candidateVerdict: after.verdict,
            metrics: CRITERIA.map(criterion => {
                const a =
                    before.metrics.find(metric => metric.criterion === criterion)?.score ?? null;
                const b =
                    after.metrics.find(metric => metric.criterion === criterion)?.score ?? null;
                return {
                    criterion,
                    baseline: a,
                    candidate: b,
                    delta: a === null || b === null ? null : b - a,
                };
            }),
        };
    });
}

const cell = (value: string | number | null | undefined) =>
    String(value ?? "unassessed")
        .replace(/\|/g, "\\|")
        .replace(/[\r\n]+/g, " ");
export function renderEvaluationMarkdown(reports: readonly EvaluationReport[]): string {
    const aggregate = aggregateEvaluations(reports);
    const lines = [
        "# Vantage validation report",
        "",
        `Rubric: ${RUBRIC_VERSION}. Judge: ${cell(aggregate.judge.kind)} / ${cell(aggregate.judge.id)}.`,
        "",
        "Scores are assessments of the supplied scenario evidence, not independent verification of real-world truth. Fixture replay is a demonstration, not a fresh model evaluation.",
        "",
        `${aggregate.total} cases: ${aggregate.passed} passed, ${aggregate.failed} failed, ${aggregate.needsReview} need review.`,
        "",
        "| Criterion | Mean / 100 | Assessed cases |",
        "| --- | ---: | ---: |",
        ...aggregate.metrics.map(
            metric =>
                `| ${metric.criterion} | ${cell(metric.mean)} | ${metric.assessedCount}/${metric.totalCount} |`
        ),
        "",
    ];
    for (const report of reports) {
        lines.push(
            `## ${cell(report.scenarioId)} — ${cell(report.candidateId)}`,
            "",
            `Verdict: **${report.verdict}**. Status: ${report.status}. Context: ${report.contextCompleteness}. Overall: ${cell(report.overallScore)}/100. Error: ${report.error ?? "none"}.`,
            "",
            `Pipeline: ${cell(report.pipelineVersion)}. Input fingerprint: ${report.inputFingerprint}.`,
            "",
            "| Criterion | Score / 100 | Method | Reason |",
            "| --- | ---: | --- | --- |",
            ...report.metrics.map(
                metric =>
                    `| ${metric.criterion} | ${cell(metric.score)} | ${metric.method} | ${cell(metric.reason)} |`
            ),
            "",
            "| Expected finding | Assessment | Reason |",
            "| --- | --- | --- |",
            ...report.expectations.map(
                item => `| ${cell(item.expectationId)} | ${item.verdict} | ${cell(item.reason)} |`
            ),
            ""
        );
        for (const issue of report.integrityIssues)
            lines.push(
                `- Integrity ${issue.severity}: ${issue.code} at ${cell(issue.outputId)}${issue.sourceId ? ` (${cell(issue.sourceId)})` : ""}.`
            );
        lines.push("", "Evidence:", "");
        for (const item of [
            ...report.expectations.map(item => ({
                label: item.expectationId,
                evidence: item.evidence,
            })),
            ...report.metrics.map(metric => ({
                label: metric.criterion,
                evidence: metric.evidence,
            })),
        ])
            for (const citation of item.evidence)
                lines.push(
                    `- ${cell(item.label)} — ${citation.kind} ${cell(citation.id)}: “${cell(citation.quote)}”`
                );
        lines.push("");
    }
    return lines.join("\n") + "\n";
}
