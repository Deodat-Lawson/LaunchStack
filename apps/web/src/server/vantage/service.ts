/**
 * Vantage service: the reads that compose several repository calls into one
 * screen (overview, triage) and the one write that needs the deployment's
 * model (prepare). Routes stay thin; tenancy is the `companyId` on the
 * context, never a value from the request.
 */
import {
    addDays,
    computeWeeklySignals,
    daysBetween,
    defaultAgendaWeek,
    getAgendaByWeek,
    lastEntryAt,
    listCommitments,
    listDeadlines,
    listEvidence,
    listHelpRequests,
    prepareAgenda,
    toIsoDate,
    weekEndOf,
    type AgendaDto,
    type CommitmentDto,
    type DeadlineDto,
    type EvidenceDto,
    type TopicDto,
    type WeeklySignals,
} from "@launchstack/pipelines/vantage";

import { resolveConfiguredChatModel } from "~/lib/models";

export interface OverviewDto {
    today: string;
    /** The week the next agenda is for, by the Thursday rule. */
    agendaWeek: string;
    agendaWeekEnd: string;
    agenda: AgendaDto | null;
    signals: WeeklySignals;
    /** Commitments to check in on: overdue or due this week. */
    checkIns: CommitmentDto[];
    recentEvidence: EvidenceDto[];
    counts: { evidenceThisWindow: number; openCommitments: number; metricsWithData: number };
    lastEntryAt: string | null;
    daysSinceLastEntry: number | null;
}

export async function loadOverview(args: { companyId: bigint; now?: Date }): Promise<OverviewDto> {
    const now = args.now ?? new Date();
    const today = toIsoDate(now);
    const agendaWeek = defaultAgendaWeek(now);
    const [{ signals }, agenda, commitments, recentEvidence, last] = await Promise.all([
        computeWeeklySignals({ companyId: args.companyId, weekStart: agendaWeek, now }),
        getAgendaByWeek({ companyId: args.companyId, weekStart: agendaWeek }),
        listCommitments({ companyId: args.companyId, status: ["open"] }),
        listEvidence({ companyId: args.companyId, since: addDays(today, -14), limit: 8 }),
        lastEntryAt(args.companyId),
    ]);
    const checkIds = new Set([
        ...signals.overdueCommitmentIds,
        ...signals.dueThisWeekCommitmentIds,
    ]);
    const checkIns = commitments.filter(c => checkIds.has(c.id));
    return {
        today,
        agendaWeek,
        agendaWeekEnd: weekEndOf(agendaWeek),
        agenda,
        signals,
        checkIns,
        recentEvidence,
        counts: {
            evidenceThisWindow: signals.newEvidence.reduce((n, e) => n + e.count, 0),
            openCommitments: commitments.length,
            metricsWithData: signals.metricChanges.length,
        },
        lastEntryAt: last ? last.toISOString() : null,
        daysSinceLastEntry: last ? daysBetween(toIsoDate(last), today) : null,
    };
}

export interface TriageDto {
    today: string;
    helpRequests: { topic: TopicDto; weekStart: string; agendaId: string }[];
    missedCommitments: CommitmentDto[];
    /** Open and shared, due in the next 14 days. */
    dueSoon: CommitmentDto[];
    deadlines: DeadlineDto[];
    lastEntryAt: string | null;
    daysSinceLastEntry: number | null;
    /** True when nothing has been logged for more than a week. */
    quiet: boolean;
}

export async function loadTriage(args: { companyId: bigint; now?: Date }): Promise<TriageDto> {
    const now = args.now ?? new Date();
    const today = toIsoDate(now);
    const horizon = addDays(today, 14);
    const [helpRequests, shared, deadlines, last] = await Promise.all([
        listHelpRequests({ companyId: args.companyId }),
        listCommitments({ companyId: args.companyId, sharedOnly: true }),
        listDeadlines({ companyId: args.companyId, from: addDays(today, -7) }),
        lastEntryAt(args.companyId),
    ]);
    const missed = shared.filter(
        c => c.status === "missed" || (c.status === "open" && c.dueOn < today)
    );
    const dueSoon = shared.filter(
        c => c.status === "open" && c.dueOn >= today && c.dueOn <= horizon
    );
    const days = last ? daysBetween(toIsoDate(last), today) : null;
    return {
        today,
        helpRequests: helpRequests.filter(h => !h.topic.decision),
        missedCommitments: missed,
        dueSoon,
        deadlines,
        lastEntryAt: last ? last.toISOString() : null,
        daysSinceLastEntry: days,
        quiet: days === null || days > 7,
    };
}

/**
 * Prepare a week's agenda with this deployment's default chat model when one
 * is configured. A missing or failing model is logged and the rules draft
 * takes over — the founder still gets an agenda, and its metadata says how
 * it was made.
 */
export async function prepareWeek(args: {
    companyId: bigint;
    userId: string;
    weekStart: string;
}): Promise<AgendaDto> {
    return prepareAgenda({
        companyId: args.companyId,
        userId: args.userId,
        weekStart: args.weekStart,
        resolveModel: () => resolveConfiguredChatModel({ route: "default" }),
        onModelError: error => {
            console.warn(
                "[vantage] agenda model unavailable, using the rules draft:",
                error instanceof Error ? error.message : error
            );
        },
    });
}
