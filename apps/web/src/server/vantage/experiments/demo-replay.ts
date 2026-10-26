/** Explicit offline replay of a recorded synthetic report, never a fresh model result. */
import { createHash } from "node:crypto";
import {
    generateWeeklyAgendaV1,
    GENERATION_PROMPT_VERSION,
    VantageError,
} from "@launchstack/pipelines/vantage";
import {
    assertRegisteredCitations,
    createContextAwareGenerationAdapter,
    contextSourceKeyV0,
    type ContextGenerationEnvelopeV0,
    type GenerationRuntime,
    type TrustedContextSourceV0,
} from "@launchstack/pipelines/vantage/context-v0";
import { GenerationOutputSchema } from "../../../../../../pipelines/src/vantage/generation-v1";
import type {
    ExperimentalReportV0,
    SophiaExperimentDiagnosticsV0,
} from "../../../../../../pipelines/src/vantage/experiments/sophia-generation-v0";
import fixture from "../../../../test-fixtures/vantage-context/rich-replay.json";

export const DEMO_REPLAY = Object.freeze({
    fixtureId: fixture.fixtureId,
    recordedAt: fixture.recordedAt,
    originalModelId: fixture.originalModelId,
});

const canonical = (value: unknown): unknown =>
    Array.isArray(value)
        ? value.map(canonical)
        : value && typeof value === "object"
          ? Object.fromEntries(
                Object.entries(value)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([key, child]) => [key, canonical(child)])
            )
          : value;
const hash = (value: unknown) =>
    createHash("sha256")
        .update(JSON.stringify(canonical(value)))
        .digest("hex");
function unavailable(): never {
    throw new VantageError(
        "The recorded synthetic replay does not match the current authorized fixture. Existing reports were retained.",
        409,
        "demo_replay_unavailable"
    );
}

/** All projected facts/unknowns/review state must match; native IDs and extraction dates may differ by machine. */
export function replayCompanyFingerprint(excerpt: string): string {
    const value = JSON.parse(excerpt) as {
        adapterVersion: string;
        reviewState: string;
        facts: Record<string, unknown>[];
        unknowns: unknown[];
    };
    if (
        value.adapterVersion !== "company-profile-adapter/v0.1" ||
        value.reviewState !== "unreviewed" ||
        !Array.isArray(value.facts) ||
        !Array.isArray(value.unknowns)
    )
        unavailable();
    return hash({
        adapterVersion: value.adapterVersion,
        reviewState: value.reviewState,
        facts: value.facts.map(fact =>
            Object.fromEntries(Object.entries(fact).filter(([key]) => key !== "sources"))
        ),
        unknowns: value.unknowns,
    });
}

/** Pure binding checks are additional replay limits, never replacements for ACL/registry/commit guards. */
export function bindDemoReplayReport(
    envelope: ContextGenerationEnvelopeV0,
    records: readonly TrustedContextSourceV0[],
    fixtureId: string
): ExperimentalReportV0 {
    if (
        envelope.v1Input.reportPeriod.weekStart !== fixture.weekStart ||
        envelope.evidenceSnapshot.entries.length !== fixture.sourceBindings.length ||
        hash([...envelope.manifest.roleIds].sort()) !== hash([...fixture.recordedRoleIds].sort())
    )
        unavailable();
    const evidence = envelope.v1Input.data.currentEvidence
        .map(({ kind, title, body, source, sourceUrl, observedAt, visibility }) => ({
            kind,
            title,
            body,
            source,
            sourceUrl,
            observedAt,
            visibility,
        }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    if (
        hash(evidence) !== fixture.nativeEvidenceSha256 ||
        [
            envelope.v1Input.data.currentObservations,
            envelope.v1Input.data.comparisonObservations,
            envelope.v1Input.data.resolvedCommitments,
            envelope.v1Input.data.carryForwardCommitments,
        ].some(values => values.length)
    )
        unavailable();
    const replacements = new Map<string, string>();
    for (const binding of fixture.sourceBindings) {
        const matches = records.filter(record =>
            binding.kind === "company"
                ? record.source.kind === "company"
                : record.source.kind === "doc" &&
                  record.provenance?.locator ===
                      `vantage-sophia-synthetic/${fixtureId}/${binding.fixtureKey}`
        );
        if (matches.length !== 1) unavailable();
        const record = matches[0]!;
        const selected = envelope.evidenceSnapshot.entries.find(
            entry => contextSourceKeyV0(entry.source) === contextSourceKeyV0(record.source)
        );
        if (
            !selected ||
            record.access !== "allowed" ||
            record.companyId !== envelope.manifest.actor.companyId ||
            record.aclDigest !== envelope.manifest.actor.aclDigest ||
            selected.contentHash !== record.contentHash ||
            selected.excerpt !== record.excerpt
        )
            unavailable();
        if (binding.kind === "company") {
            if (replayCompanyFingerprint(record.excerpt) !== binding.semanticSha256) unavailable();
        } else if (
            record.contentHash !== binding.contentSha256 ||
            createHash("sha256").update(record.excerpt).digest("hex") !== binding.contentSha256 ||
            createHash("sha256")
                .update(record.content ?? record.excerpt)
                .digest("hex") !== binding.contentSha256
        )
            unavailable();
        if (binding.originalRef)
            replacements.set(binding.originalRef, contextSourceKeyV0(record.source));
    }
    const original = GenerationOutputSchema.parse(fixture.report);
    const refs = (values: string[]) =>
        assertRegisteredCitations(
            envelope,
            values.map(ref => replacements.get(ref) ?? unavailable())
        ).map(ref => ({ kind: ref.kind, id: ref.id, version: ref.version }));
    return {
        summary: original.summary,
        origin: "ai",
        enhancements: [],
        topics: original.topics.map(topic => ({
            title: topic.title,
            facts: topic.facts.map(fact => ({ text: fact.text, refs: refs(fact.refs) })),
            conflicts: topic.conflicts.map(fact => ({ text: fact.text, refs: refs(fact.refs) })),
            whyItMatters: topic.whyItMatters,
            decisionQuestion: topic.decisionQuestion,
            proposedNextStep: topic.proposedNextStep,
            proposedOwner: null,
            proposedDue: null,
            helpRequested: null,
            unknowns: topic.unknowns,
            rationale: topic.rationale,
        })),
    };
}

export async function replayContextDemo(
    envelope: ContextGenerationEnvelopeV0,
    records: readonly TrustedContextSourceV0[],
    fixtureId: string,
    runtime: GenerationRuntime
) {
    const started = performance.now();
    let report: ExperimentalReportV0 | undefined;
    const generate = createContextAwareGenerationAdapter(async (safeEnvelope, safeRuntime) => {
        report = bindDemoReplayReport(safeEnvelope, records, fixtureId);
        // Native V1 remains deterministic Rules; replay text lives only in the clearly labeled experimental sidecar.
        const v1Result = await generateWeeklyAgendaV1(safeEnvelope.v1Input, {
            ...safeRuntime,
            resolveModel: () => null,
        });
        const citationRefs = [
            ...new Map(
                report.topics
                    .flatMap(topic =>
                        [...topic.facts, ...topic.conflicts].flatMap(fact => fact.refs)
                    )
                    .map(ref => [contextSourceKeyV0(ref), ref])
            ).values(),
        ];
        return { v1Result, citationRefs };
    });
    const generated = await generate(envelope, { ...runtime, resolveModel: () => null });
    if (!report) unavailable();
    const diagnostics: SophiaExperimentDiagnosticsV0 = {
        promptVersion: "vantage/context-replay/v1",
        basePromptVersion: GENERATION_PROMPT_VERSION,
        modelId: fixture.originalDeploymentId,
        providerAttempts: 0,
        generationAttempts: 0,
        promptBytes: 0,
        promptBytesByAttempt: [],
        promptOmissionsByAttempt: [],
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        contextFingerprint: envelope.manifest.contextFingerprint,
        sourceKeys: envelope.evidenceSnapshot.entries.map(entry =>
            contextSourceKeyV0(entry.source)
        ),
        durationMs: Math.ceil(performance.now() - started),
    };
    return { generated, report, diagnostics };
}
