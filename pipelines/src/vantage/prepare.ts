/** Historical signal reads used by overview and triage. */
import {
    listCommitmentRows,
    listEvidenceRows,
    listMetricDefinitionRows,
    listObservationRows,
} from "./db";
import { WINDOW_DAYS, buildEvidencePack, computeSignals, type SignalInputs } from "./signals";
import type { WeeklySignals, EvidencePack } from "./types";
import { addDays, toIsoDate } from "./week";
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
