/**
 * Preparing a week's agenda — the loop's one orchestration:
 *
 *   rows ──► signals ──► evidence pack ──► draft (model, else rules) ──► topics
 *
 * The model is optional by design. A workspace with no chat model still gets
 * a draft from the rules, and a model call that fails falls back to the same
 * rules rather than to an empty agenda; the agenda records which it got.
 */

import type { ResolvedChatModel } from "@launchstack/llm";

import {
    ensureAgenda,
    getAgenda,
    listCommitmentRows,
    listEvidenceRows,
    listMetricDefinitionRows,
    listObservationRows,
    replaceGeneratedTopics,
} from "./db";
import { generateAgendaDraft } from "./generator";
import {
    WINDOW_DAYS,
    buildEvidencePack,
    computeSignals,
    draftFromRules,
    type SignalInputs,
} from "./signals";
import type { AgendaDraft, AgendaDto, EvidencePack, WeeklySignals } from "./types";
import { addDays, toIsoDate } from "./week";

export interface PrepareAgendaArgs {
    companyId: bigint;
    userId: string;
    weekStart: string;
    now?: Date;
    /**
     * Resolved lazily so a workspace without a model does not pay for
     * resolution errors twice. Return null to skip the model entirely.
     */
    resolveModel?: () => ResolvedChatModel | null;
    /** Called when the model path fails, before the rules take over. */
    onModelError?: (error: unknown) => void;
}

/** The rows the signals and the pack are computed from, in one read. */
export async function loadSignalInputs(args: {
    companyId: bigint;
    weekStart: string;
    now: Date;
}): Promise<SignalInputs> {
    // Older evidence still matters for the pack window; commitments and
    // observations are bounded by their own limits.
    const since = addDays(toIsoDate(args.now), -(WINDOW_DAYS * 2));
    const [definitions, observations, evidence, commitments] = await Promise.all([
        listMetricDefinitionRows(args.companyId),
        listObservationRows({ companyId: args.companyId }),
        listEvidenceRows({ companyId: args.companyId, since }),
        listCommitmentRows(args.companyId),
    ]);
    return {
        weekStart: args.weekStart,
        now: args.now,
        definitions,
        observations,
        evidence,
        commitments,
    };
}

export async function computeWeeklySignals(args: {
    companyId: bigint;
    weekStart: string;
    now?: Date;
}): Promise<{ signals: WeeklySignals; inputs: SignalInputs; pack: EvidencePack }> {
    const now = args.now ?? new Date();
    const inputs = await loadSignalInputs({
        companyId: args.companyId,
        weekStart: args.weekStart,
        now,
    });
    const signals = computeSignals(inputs);
    const pack = buildEvidencePack(inputs, signals);
    return { signals, inputs, pack };
}

export async function prepareAgenda(args: PrepareAgendaArgs): Promise<AgendaDto> {
    const now = args.now ?? new Date();
    const { signals, inputs, pack } = await computeWeeklySignals({
        companyId: args.companyId,
        weekStart: args.weekStart,
        now,
    });

    let draft: AgendaDraft | null = null;
    const model = args.resolveModel ? safeResolve(args.resolveModel, args.onModelError) : null;
    if (model && pack.items.length > 0) {
        try {
            draft = await generateAgendaDraft({ pack, model, today: toIsoDate(now) });
        } catch (error) {
            args.onModelError?.(error);
            draft = null;
        }
    }
    if (!draft) {
        draft = draftFromRules(pack, inputs);
        if (model && pack.items.length > 0)
            draft.modelMetadata = { ...draft.modelMetadata, fallback: "model-failed" };
        else if (!model) draft.modelMetadata = { ...draft.modelMetadata, fallback: "no-model" };
    }

    const agenda = await ensureAgenda({
        companyId: args.companyId,
        userId: args.userId,
        weekStart: args.weekStart,
    });
    await replaceGeneratedTopics({
        companyId: args.companyId,
        agendaId: agenda.id,
        summary: draft.summary,
        signals,
        modelMetadata: draft.modelMetadata,
        origin: draft.origin,
        topics: draft.topics,
    });
    const stored = await getAgenda({ companyId: args.companyId, id: agenda.id });
    if (!stored) throw new Error("Agenda vanished during preparation");
    return stored;
}

function safeResolve(
    resolve: () => ResolvedChatModel | null,
    onError?: (error: unknown) => void
): ResolvedChatModel | null {
    try {
        return resolve();
    } catch (error) {
        onError?.(error);
        return null;
    }
}
