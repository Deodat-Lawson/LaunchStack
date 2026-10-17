import { z } from "zod";
import {
    generationSnapshot,
    saveGeneration,
    reportPeriod,
    getAgendaV1,
    calendarAdd,
    reportingDate,
    VantageError,
    type GenerationInput,
    type GenerationPort,
    type GenerationResult,
    type GenerationRuntime,
    type VantageEvidenceRef,
    type WeeklySignals,
} from "@launchstack/pipelines/vantage";
import { resolveConfiguredChatModel } from "~/lib/models";
import { getVantageGenerationPort } from "./generation-port";

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
    modelId: z.string().nullable(),
    promptVersion: z.string(),
    attempts: z.number().int().min(0).max(2),
    durationMs: z.number().finite().min(0),
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
    signals: z
        .object({
            weekStart: z.string(),
            since: z.string(),
            computedAt: z.string(),
            metricChanges: z.array(z.unknown()),
            metricConflicts: z.array(z.unknown()),
            metricsWithoutData: z.array(z.unknown()),
            newEvidence: z.array(z.unknown()),
            recentEvidenceIds: z.array(z.string()),
            overdueCommitmentIds: z.array(z.string()),
            dueThisWeekCommitmentIds: z.array(z.string()),
            resolvedCommitmentIds: z.array(z.string()),
            daysSinceLastEntry: z.number().nullable(),
        })
        .passthrough(),
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
    if (
        result.signals.since !== input.reportPeriod.weekStart ||
        result.signals.computedAt !== input.reportPeriod.asOf ||
        (input.generationMode === "rules" && result.execution.attempts !== 0) ||
        (result.execution.mode === "ai" &&
            (result.execution.attempts < 1 || !result.execution.modelId)) ||
        (result.execution.outcome === "empty" &&
            (result.draft.topics.length !== 0 ||
                result.execution.mode !== "rules" ||
                result.execution.attempts !== 0))
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
export async function prepareWeekV1(
    args: {
        companyId: bigint;
        userId: string;
        weekStart?: string;
        generationMode?: "rules" | "configured-model";
    },
    options: { now?: Date; generate?: GenerationPort; revalidate?: () => Promise<void> } = {}
) {
    const period = reportPeriod(options.now ?? new Date(), args.weekStart);
    const snapshot = await generationSnapshot(
        args.companyId,
        period,
        args.generationMode ?? "configured-model"
    );
    const generate = options.generate ?? getVantageGenerationPort();
    const controller = new AbortController();
    const runtime: GenerationRuntime = {
        resolveModel: () => resolveConfiguredChatModel({ route: "default" }),
        signal: controller.signal,
        budgets: { attemptTimeoutMs: 20000, maxAttempts: 2, retryWaitMs: 1000, totalMs: 45000 },
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const raw = await Promise.race([
            generate(structuredClone(snapshot.input), runtime),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                    controller.abort();
                    reject(
                        new VantageError("Generation deadline exceeded.", 500, "generation_failed")
                    );
                }, 45000);
            }),
        ]);
        const result = validateGenerationResult(snapshot.input, raw);
        await options.revalidate?.();
        return await saveGeneration(args.companyId, args.userId, snapshot, result);
    } catch (err) {
        if (err instanceof VantageError) throw err;
        throw new VantageError(
            "Generation or persistence failed. The prior report was retained.",
            500,
            "generation_failed"
        );
    } finally {
        if (timer) clearTimeout(timer);
        controller.abort();
    }
}

export async function loadOverviewV1(args: { companyId: bigint; now?: Date }) {
    const now = args.now ?? new Date(),
        period = reportPeriod(now);
    const [{ input }, agenda, previousAgenda] = await Promise.all([
        generationSnapshot(args.companyId, period, "configured-model"),
        getAgendaV1(args.companyId, { weekStart: period.weekStart }),
        getAgendaV1(args.companyId, { weekStart: calendarAdd(period.weekStart, -7) }),
    ]);
    const data = input.data;
    const empty: WeeklySignals = {
        weekStart: period.weekStart,
        since: period.weekStart,
        computedAt: period.asOf,
        metricChanges: [],
        metricConflicts: [],
        metricsWithoutData: [],
        newEvidence: [],
        recentEvidenceIds: data.currentEvidence.map(e => e.id),
        overdueCommitmentIds: [],
        dueThisWeekCommitmentIds: [],
        resolvedCommitmentIds: data.resolvedCommitments.map(c => c.id),
        daysSinceLastEntry: null,
    };
    const last =
        [...data.currentEvidence, ...data.currentObservations]
            .map(e => e.createdAt)
            .sort()
            .at(-1) ?? null;
    return {
        today: reportingDate(now),
        agendaWeek: period.weekStart,
        agendaWeekEnd: calendarAdd(period.weekStart, 6),
        agenda,
        previousAgenda,
        signals: agenda?.signals ?? empty,
        checkIns: data.carryForwardCommitments,
        recentEvidence: data.currentEvidence.slice(0, 8),
        counts: {
            evidenceThisWindow: data.currentEvidence.length,
            openCommitments: data.carryForwardCommitments.length,
            metricsWithData: new Set(data.currentObservations.map(o => o.metricId)).size,
        },
        lastEntryAt: last,
        daysSinceLastEntry: null,
        reportPeriod: period,
    };
}
