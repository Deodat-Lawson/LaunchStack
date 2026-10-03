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
    /**
     * The week before's agenda: once its meeting is held, its undecided
     * topics are what Vantage suggests committing to, even after the Thursday
     * rule has moved "next meeting" on.
     */
    previousAgenda: AgendaDto | null;
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
    const [{ signals }, agenda, previousAgenda, commitments, recentEvidence, last] =
        await Promise.all([
            computeWeeklySignals({ companyId: args.companyId, weekStart: agendaWeek, now }),
            getAgendaByWeek({ companyId: args.companyId, weekStart: agendaWeek }),
            getAgendaByWeek({ companyId: args.companyId, weekStart: addDays(agendaWeek, -7) }),
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
        previousAgenda,
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
 * Prepares running on this server, by workspace and week. Vantage drafts a
 * week when someone opens it, so a reload, a second tab or a teammate
 * opening the same empty week while its draft is still being written must
 * not start a second model call — they wait for the one already running and
 * get the same agenda. Forgotten once it settles, so a later "fresh
 * suggestions" really asks again. (One server process holds the map; the
 * deployment runs one.)
 */
const preparing = new Map<string, Promise<AgendaDto>>();

/**
 * Prepare a week's agenda with this deployment's default chat model when one
 * is configured. A missing or failing model is logged and the rules draft
 * takes over — the founder still gets an agenda, and its metadata says how
 * it was made.
 */
export function prepareWeek(args: {
    companyId: bigint;
    userId: string;
    weekStart: string;
}): Promise<AgendaDto> {
    const key = `${args.companyId}:${args.weekStart}`;
    const running = preparing.get(key);
    if (running) return running;
    const draft = prepareAgenda({
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
    }).finally(() => preparing.delete(key));
    preparing.set(key, draft);
    return draft;
}
