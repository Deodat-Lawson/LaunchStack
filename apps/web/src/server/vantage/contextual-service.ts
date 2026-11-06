/** Milestone-only replay facade; no live transport selection is exposed to HTTP. */
import { randomUUID } from "node:crypto";
import {
    runFinanceMilestoneGeneration,
    evaluateFinanceMilestoneReport,
} from "../../../../../pipelines/src/vantage/experiments/finance-milestone-v1";
import { VantageError } from "@launchstack/pipelines/vantage";
import { createContextualHost } from "./contextual-host";
import { extractDemoV2Fields } from "./demo-v2-fields";
import type { DemoReport } from "~/app/employer/tools/vantage/demo-contract";
export function createContextualService(deps: Parameters<typeof createContextualHost>[0] = {}) {
    const host = createContextualHost(deps);
    async function generateWeek(weekStart = "2026-10-12") {
        const prepared = await host.prepare({ weekStart });
        const result = await runFinanceMilestoneGeneration({
            envelope: prepared.envelope,
            sourceRefs: prepared.sourceRefs,
            resolvePrimaryRole: () => prepared.roleContext,
        });
        if (!result.output) {
            console.error(
                "[vantage] contextual replay validation failed",
                JSON.stringify({
                    outcome: result.outcome,
                    attempts: result.attempts.map(attempt => ({
                        stage: attempt.stage,
                        issueCount: attempt.issues.length,
                    })),
                    setupReason: "setup" in result ? result.setup?.reason : undefined,
                })
            );
            throw new VantageError(
                "Deterministic replay did not satisfy generation validation.",
                409,
                "contextual_generation_invalid"
            );
        }
        const output = result.output,
            semantic = evaluateFinanceMilestoneReport(output.report, prepared.sourceRefs);
        if (!semantic.passed)
            throw new VantageError(
                "Finance definition coverage needs review.",
                409,
                "contextual_semantic_failed"
            );
        const report: DemoReport = {
            id: randomUUID(),
            weekStart,
            generatedAt: (deps.now?.() ?? new Date()).toISOString(),
            version: 1,
            summary: output.report.summary,
            ...extractDemoV2Fields(output.report),
            topics: output.report.topics.map(topic => ({
                ...topic,
                id: randomUUID(),
                status: "suggested",
            })),
            execution: {
                mode: "replay",
                modelId: output.diagnostics.modelId,
                promptVersion: output.diagnostics.promptVersion,
                attempts: output.diagnostics.providerAttempts,
                durationMs: output.diagnostics.durationMs,
                fallbackReason: null,
            },
            diagnostics: {
                sources: prepared.records.map(r => ({
                    source: r.source,
                    title:
                        r.source.kind === "company"
                            ? "Company Architecture"
                            : `Document ${r.source.id}`,
                    contentHash: r.contentHash!,
                })),
                contextFingerprint: prepared.context.manifest.contextFingerprint,
                persisted: true,
                historicalHumanDecisions: 0,
                semanticAssessment: {
                    kind: "deterministic-manual-checklist",
                    passed: semantic.passed,
                    modelJudgeUsed: false,
                },
            },
        };
        await host.commit(prepared, output.generated, report, result.trace.validatedCompound);
        return host.load({ reportId: report.id });
    }
    return { ...host, generateWeek };
}
