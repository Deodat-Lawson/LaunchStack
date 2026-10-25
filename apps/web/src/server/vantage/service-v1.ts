import {
    generationSnapshot,
    saveGeneration,
    reportPeriod,
    getAgendaV1,
    calendarAdd,
    reportingDate,
    VantageError,
    validateGenerationResult,
    type GenerationPort,
    type GenerationRuntime,
    type WeeklySignals,
} from "@launchstack/pipelines/vantage";
import { resolveConfiguredChatModel } from "~/lib/models";
import { getVantageGenerationPort } from "./generation-port";

export { validateGenerationResult };

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
        args.generationMode ?? "configured-model",
        { actorId: args.userId }
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
