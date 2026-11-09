import { z } from "zod";
import { VantageError } from "./db";
import type { GenerationInput, GenerationResult } from "./contract-v1";
import type { VantageEvidenceRef } from "./types";
import { eventStateContradictions } from "./event-state-grounding-v1";
import { computeGenerationSignals, eligibleInput, selectGenerationEvidence } from "./evidence-v1";

const ref = z.object({ ref: z.string().min(1), label: z.string(), date: z.string().nullable() });
const fact = z.object({
    text: z.string().min(1).max(600),
    refs: z.array(ref).max(8),
    unsupported: z.boolean().optional(),
});
const draftTopic = z.object({
    title: z.string().min(1).max(300),
    facts: z.array(fact).max(8),
    whyItMatters: z.string().max(2000),
    decisionQuestion: z.string().max(1000),
    proposedNextStep: z.string().max(1000),
    proposedOwner: z.string().nullable(),
    proposedDue: z.string().nullable(),
    helpRequested: z.string().nullable(),
    unknowns: z.array(z.string()).max(8),
    conflicts: z.array(z.object({ text: z.string(), refs: z.array(ref) })).max(6),
    rationale: z.string(),
});
const execution = z.object({
    outcome: z.enum(["generated", "empty"]),
    mode: z.enum(["ai", "rules"]),
    fallbackReason: z.enum(["no-model", "timeout", "provider-error", "invalid-output"]).nullable(),
    modelId: z.string().trim().min(1).nullable(),
    promptVersion: z.string().trim().min(1),
    attempts: z.number().int().min(0).max(2),
    durationMs: z.number().finite().min(0).max(45000),
});
const signalObservation = z.object({
    observationId: z.string().min(1),
    value: z.number().finite(),
    periodStart: z.string(),
    periodEnd: z.string(),
});
const metricIdentity = z.object({
    metricId: z.string().min(1),
    key: z.string(),
    name: z.string(),
});
const signals = z.object({
    weekStart: z.string(),
    since: z.string(),
    computedAt: z.string(),
    metricChanges: z.array(
        metricIdentity.extend({
            unit: z.string(),
            definition: z.string(),
            latest: signalObservation,
            previous: signalObservation.nullable(),
            delta: z.number().finite().nullable(),
            pct: z.number().finite().nullable(),
            direction: z.enum(["up", "down", "flat", "new"]),
            notable: z.boolean(),
        })
    ),
    metricConflicts: z.array(
        metricIdentity.extend({
            a: signalObservation.extend({ source: z.string().nullable() }),
            b: signalObservation.extend({ source: z.string().nullable() }),
        })
    ),
    metricsWithoutData: z.array(metricIdentity),
    newEvidence: z.array(
        z.object({
            kind: z.enum(["note", "interview", "link", "task", "claim", "document"]),
            count: z.number().int().nonnegative(),
        })
    ),
    recentEvidenceIds: z.array(z.string()),
    overdueCommitmentIds: z.array(z.string()),
    dueThisWeekCommitmentIds: z.array(z.string()),
    resolvedCommitmentIds: z.array(z.string()),
    daysSinceLastEntry: z.number().int().nonnegative().nullable(),
});
const resultSchema = z.object({
    runId: z.string(),
    inputVersion: z.string(),
    draft: z.object({
        summary: z.string().max(1200),
        topics: z.array(draftTopic).max(5),
        origin: z.enum(["ai", "rules"]),
        modelMetadata: z.record(z.unknown()),
    }),
    signals,
    enhancements: z
        .array(
            z.object({
                topicId: z.string(),
                baseTopicVersion: z.number().int().positive(),
                kind: z.enum(["evidence", "idea", "question"]),
                text: z.string().min(1).max(2000),
                refs: z.array(ref).max(8),
                rationale: z.string().max(1000),
            })
        )
        .max(30),
    execution,
});

/** Signals must point back to the authorized, period-bounded input collections. */
function validateSignals(input: GenerationInput, result: GenerationResult) {
    const definitions = new Map(input.data.metricDefinitions.map(d => [d.id, d]));
    const current = new Map(input.data.currentObservations.map(o => [o.id, o]));
    const comparison = new Map(input.data.comparisonObservations.map(o => [o.id, o]));
    const evidence = new Set(input.data.currentEvidence.map(e => e.id));
    const carryForward = new Set(input.data.carryForwardCommitments.map(c => c.id));
    const resolved = new Set(input.data.resolvedCommitments.map(c => c.id));
    const fail = () => {
        throw new VantageError(
            "Generation signals do not match the supplied data.",
            500,
            "generation_failed"
        );
    };
    const checkIdentity = (metric: { metricId: string; key: string; name: string }) => {
        const definition = definitions.get(metric.metricId);
        if (!definition || definition.key !== metric.key || definition.name !== metric.name)
            return fail();
        return definition;
    };
    const checkObservation = (
        metricId: string,
        item: z.infer<typeof signalObservation> & { source?: string | null },
        allowed: typeof current
    ) => {
        const observation = allowed.get(item.observationId);
        if (
            !observation ||
            observation.metricId !== metricId ||
            observation.value !== item.value ||
            observation.periodStart !== item.periodStart ||
            observation.periodEnd !== item.periodEnd ||
            ("source" in item && observation.source !== item.source)
        )
            fail();
    };
    const checkIds = (ids: string[], allowed: Set<string>) => {
        if (new Set(ids).size !== ids.length || ids.some(id => !allowed.has(id))) fail();
    };
    for (const change of result.signals.metricChanges) {
        const definition = checkIdentity(change);
        if (change.unit !== definition.unit || change.definition !== definition.definition) fail();
        checkObservation(change.metricId, change.latest, current);
        if (change.previous) checkObservation(change.metricId, change.previous, comparison);
    }
    for (const conflict of result.signals.metricConflicts) {
        checkIdentity(conflict);
        checkObservation(conflict.metricId, conflict.a, current);
        checkObservation(conflict.metricId, conflict.b, current);
    }
    for (const metric of result.signals.metricsWithoutData) {
        checkIdentity(metric);
        if (input.data.currentObservations.some(o => o.metricId === metric.metricId)) fail();
    }
    const kinds = new Set<string>();
    for (const item of result.signals.newEvidence) {
        const count = input.data.currentEvidence.filter(e => e.kind === item.kind).length;
        if (kinds.has(item.kind) || item.count !== count) fail();
        kinds.add(item.kind);
    }
    checkIds(result.signals.recentEvidenceIds, evidence);
    checkIds(result.signals.overdueCommitmentIds, carryForward);
    checkIds(result.signals.dueThisWeekCommitmentIds, carryForward);
    checkIds(result.signals.resolvedCommitmentIds, resolved);
}

/** Boundary validation is TL-owned; model generation/repair remains B-owned. */
export function validateGenerationResult(input: GenerationInput, raw: unknown): GenerationResult {
    const parsed = resultSchema.safeParse(raw);
    if (!parsed.success)
        throw new VantageError(
            "Generation returned invalid structured data.",
            500,
            "generation_failed"
        );
    const result = parsed.data as GenerationResult;
    const record = result.execution;
    const explicitRules = input.generationMode === "rules";
    const empty = record.outcome === "empty";
    if (
        result.signals.since !== input.reportPeriod.weekStart ||
        result.signals.computedAt !== input.reportPeriod.asOf ||
        (explicitRules && (record.attempts !== 0 || record.fallbackReason !== null)) ||
        (record.mode === "ai" &&
            (record.attempts < 1 || !record.modelId || record.fallbackReason !== null)) ||
        (record.mode === "rules" && record.modelId !== null) ||
        (record.mode === "rules" && !explicitRules && !empty && record.fallbackReason === null) ||
        (record.fallbackReason === "no-model" && record.attempts !== 0) ||
        (record.fallbackReason !== null &&
            record.fallbackReason !== "no-model" &&
            record.attempts === 0) ||
        (empty &&
            (result.draft.topics.length !== 0 ||
                result.enhancements.length !== 0 ||
                record.mode !== "rules" ||
                record.attempts !== 0 ||
                record.fallbackReason !== null))
    ) {
        throw new VantageError(
            "Generation metadata violates the reporting contract.",
            500,
            "generation_failed"
        );
    }
    if (
        result.runId !== input.runId ||
        result.inputVersion !== input.inputVersion ||
        result.signals.weekStart !== input.reportPeriod.weekStart ||
        result.draft.origin !== result.execution.mode ||
        result.draft.modelMetadata.mode !== result.execution.mode ||
        (input.generationMode === "rules" && result.execution.mode !== "rules")
    )
        throw new VantageError(
            "Generation result does not match its input or actual mode.",
            500,
            "generation_failed"
        );
    validateSignals(input, result);
    const eligible = eligibleInput(input);
    const { pack } = selectGenerationEvidence(eligible, computeGenerationSignals(eligible));
    if (
        eventStateContradictions(
            { ...result.draft, enhancements: result.enhancements },
            pack.items,
            input.reportPeriod.weekStart.slice(0, 4)
        ).length
    )
        throw new VantageError(
            "Generation contradicts an explicit supplied event state.",
            500,
            "generation_failed"
        );
    const refs = new Map<string, VantageEvidenceRef>();
    for (const e of input.data.currentEvidence)
        refs.set(`ev:${e.id}`, {
            ref: `ev:${e.id}`,
            label: e.source ?? e.title,
            date: e.observedAt,
        });
    for (const o of [...input.data.currentObservations, ...input.data.comparisonObservations])
        refs.set(`obs:${o.id}`, {
            ref: `obs:${o.id}`,
            label: o.source ?? o.metricName,
            date: o.periodEnd,
        });
    for (const c of [...input.data.resolvedCommitments, ...input.data.carryForwardCommitments])
        refs.set(`cm:${c.id}`, { ref: `cm:${c.id}`, label: c.title, date: c.dueOn });
    const canonical = (items: VantageEvidenceRef[]) =>
        items.map(r => refs.get(r.ref)).filter((r): r is VantageEvidenceRef => !!r);
    for (const t of result.draft.topics) {
        for (const f of t.facts) {
            const original = f.refs.length;
            f.refs = canonical(f.refs);
            if (!f.refs.length || f.refs.length !== original) f.unsupported = true;
        }
        for (const c of t.conflicts) c.refs = canonical(c.refs);
    }
    for (const e of result.enhancements) {
        if (
            !input.reviewedTopics.some(
                t => t.topic.id === e.topicId && t.contentVersion === e.baseTopicVersion
            ) ||
            e.refs.some(r => !refs.has(r.ref)) ||
            (e.kind === "evidence" && !e.refs.length)
        )
            throw new VantageError(
                "Enhancement target or sources are invalid.",
                500,
                "generation_failed"
            );
        e.refs = canonical(e.refs);
    }
    return result;
}
