import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lt, lte, or, sql } from "drizzle-orm";
import { getDb } from "@launchstack/store/client";
import {
    VantageError,
    orNull,
    toCommitmentDto,
    toDefinitionDto,
    toEvidenceDto,
    toTopicDto,
    type TopicInput,
    type CommitmentInput,
    type ObservationInput,
    createObservations,
} from "./db";
import {
    vantageAgendas as agendas,
    vantageAgendaTopics as topics,
    vantageCommitments as commitments,
    vantageContractState as states,
    vantageEvidence as evidence,
    vantageMetricDefinitions as definitions,
    vantageMetricObservations as observations,
    type VantageAgendaStatus,
    type VantageCommitmentStatus,
} from "./schema";
import type {
    AgendaV1Dto,
    EnhancementDto,
    GenerationInput,
    GenerationResult,
    ReportPeriod,
    TopicV1Dto,
} from "./contract-v1";
import type { CommitmentDto, MetricObservationDto, WeeklySignals } from "./types";
import { calendarAdd, reportingDate, reportPeriod, validDate } from "./period-v1";
import {
    emptyPendingHistoricalState,
    pendingHistoricalState,
    mergePendingHistoricalState,
    projectPendingHistoricalQuestions,
    PENDING_VALIDATION_BATCH_SIZE,
    PENDING_QUESTIONS_CONTRACT,
    type PendingHistoricalStateV1,
    type PendingHistoricalQuestionsViewV1,
    type PendingOriginAvailability,
} from "./pending-questions-v1";
export type {
    PendingHistoricalQuestionV1,
    PendingHistoricalQuestionsContextV1,
    PendingHistoricalQuestionsViewV1,
} from "./pending-questions-v1";
import {
    assemblePreviousVantageContext,
    MAX_PREVIOUS_VANTAGE_REFS,
    MAX_PREVIOUS_VANTAGE_TOPICS,
    previousTopicRefs,
    previousVantageFingerprint,
    type PreviousVantageSource,
} from "./previous-context-v1";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type ReadDb = Pick<Db, "select">;
interface State {
    period?: ReportPeriod;
    execution?: GenerationResult["execution"];
    topicVersions: Record<string, number>;
    enhancements: EnhancementDto[];
    submissions: Record<string, { hash: string; topicId: string }>;
    pendingHistoricalQuestions?: PendingHistoricalStateV1;
}
const fresh = (): State => ({ topicVersions: {}, enhancements: [], submissions: {} });
export function fingerprint(value: unknown): string {
    const canonical = (v: unknown): unknown =>
        Array.isArray(v)
            ? v.map(canonical)
            : v && typeof v === "object"
              ? Object.fromEntries(
                    Object.entries(v)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([k, x]) => [k, canonical(x)])
                )
              : v;
    return createHash("sha256")
        .update(JSON.stringify(canonical(value)))
        .digest("hex");
}
async function state(db: ReadDb, companyId: bigint, agendaId: string) {
    const [row] = await db
        .select()
        .from(states)
        .where(and(eq(states.agendaId, agendaId), eq(states.companyId, companyId)));
    return {
        version: row?.version ?? 0,
        data: row ? ({ ...fresh(), ...row.payload } as State) : fresh(),
    };
}
async function putState(tx: Tx, companyId: bigint, agendaId: string, version: number, data: State) {
    const payload = data as unknown as Record<string, unknown>;
    await tx
        .insert(states)
        .values({ agendaId, companyId, version, payload })
        .onConflictDoUpdate({ target: states.agendaId, set: { version, payload } });
}
/** Short test-pilot write lock covers agenda and generation-source writers, never model calls. */
async function lock(tx: Tx) {
    await tx.execute(
        sql`LOCK TABLE ${agendas}, ${topics}, ${commitments}, ${states}, ${evidence}, ${definitions}, ${observations} IN SHARE ROW EXCLUSIVE MODE`
    );
}
async function read(
    db: ReadDb,
    companyId: bigint,
    selector: { id: string } | { weekStart: string }
): Promise<AgendaV1Dto | null> {
    const [row] = await db
        .select()
        .from(agendas)
        .where(
            and(
                eq(agendas.companyId, companyId),
                "id" in selector
                    ? eq(agendas.id, selector.id)
                    : eq(agendas.weekStart, selector.weekStart)
            )
        );
    if (!row) return null;
    const [rows, links, s] = await Promise.all([
        db
            .select()
            .from(topics)
            .where(and(eq(topics.companyId, companyId), eq(topics.agendaId, row.id)))
            .orderBy(asc(topics.position), asc(topics.id)),
        db
            .select()
            .from(commitments)
            .where(
                and(
                    eq(commitments.companyId, companyId),
                    or(
                        eq(commitments.agendaId, row.id),
                        inArray(
                            commitments.topicId,
                            db
                                .select({ id: topics.id })
                                .from(topics)
                                .where(
                                    and(
                                        eq(topics.companyId, companyId),
                                        eq(topics.agendaId, row.id)
                                    )
                                )
                        )
                    )
                )
            ),
        state(db, companyId, row.id),
    ]);
    const dtoTopics = rows.map(t => {
        const linked = links.filter(c => c.topicId === t.id);
        if (linked.length > 1)
            throw new VantageError(
                "Ambiguous linked actions need review.",
                409,
                "commitment_ambiguous"
            );
        return {
            ...toTopicDto(t, linked[0]?.id ?? null),
            contentVersion: s.data.topicVersions[t.id] ?? 1,
        };
    });
    return {
        id: row.id,
        weekStart: row.weekStart,
        weekEnd: calendarAdd(row.weekStart, 6),
        status: row.status,
        summary: row.summary,
        signals: row.signals as unknown as WeeklySignals | null,
        modelMetadata: row.modelMetadata,
        generatedAt: row.generatedAt?.toISOString() ?? null,
        heldAt: row.heldAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        topics: dtoTopics,
        reportPeriod: s.data.period ?? null,
        version: s.version,
        enhancements: s.data.enhancements,
        execution: s.data.execution ?? null,
    };
}
export function getAgendaV1(companyId: bigint, selector: { id: string } | { weekStart: string }) {
    return read(getDb(), companyId, selector);
}

/** Read existing Vantage entities only. A company document row is never an actor ACL grant. */
async function previousVantageSnapshot(
    db: ReadDb,
    companyId: bigint,
    period: ReportPeriod,
    actorId: string | undefined,
    knownMetricDefinitions: readonly { id: string }[]
) {
    const knownMetricIds = new Set(knownMetricDefinitions.map(definition => definition.id));
    const weekStart = calendarAdd(period.weekStart, -7);
    const [row] = await db
        .select()
        .from(agendas)
        // Exactly one predecessor: skipped calendar weeks must not erase saved lineage.
        // The AI-history assembler independently requires the immediately prior calendar week.
        .where(and(eq(agendas.companyId, companyId), lt(agendas.weekStart, period.weekStart)))
        .orderBy(desc(agendas.weekStart))
        .limit(1);
    if (!row)
        return {
            context: null,
            report: null,
            reportAfterCutoff: false,
            pendingHistoricalState: emptyPendingHistoricalState(),
            fingerprint: previousVantageFingerprint({
                actorId: actorId ?? null,
                weekStart,
                missing: true,
            }),
        };
    const [priorTopics, priorActions, priorState] = await Promise.all([
        db
            .select()
            .from(topics)
            .where(and(eq(topics.companyId, companyId), eq(topics.agendaId, row.id)))
            .orderBy(asc(topics.position), asc(topics.id)),
        db
            .select()
            .from(commitments)
            .where(
                and(
                    eq(commitments.companyId, companyId),
                    or(
                        eq(commitments.agendaId, row.id),
                        inArray(
                            commitments.topicId,
                            db
                                .select({ id: topics.id })
                                .from(topics)
                                .where(
                                    and(
                                        eq(topics.companyId, companyId),
                                        eq(topics.agendaId, row.id)
                                    )
                                )
                        )
                    )
                )
            )
            .orderBy(asc(commitments.id)),
        state(db, companyId, row.id),
    ]);
    const report: AgendaV1Dto = {
        id: row.id,
        weekStart: row.weekStart,
        weekEnd: calendarAdd(row.weekStart, 6),
        status: row.status,
        summary: row.summary,
        signals: row.signals as unknown as WeeklySignals | null,
        modelMetadata: row.modelMetadata,
        generatedAt: row.generatedAt?.toISOString() ?? null,
        heldAt: row.heldAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        topics: priorTopics.map(topic => ({
            ...toTopicDto(
                topic,
                priorActions.find(action => action.topicId === topic.id)?.id ?? null
            ),
            contentVersion: priorState.data.topicVersions[topic.id] ?? 1,
        })),
        reportPeriod: priorState.data.period ?? null,
        version: priorState.version,
        enhancements: priorState.data.enhancements,
        execution: priorState.data.execution ?? null,
    };
    const rawRefs = [
        ...new Set(
            report.topics
                .slice(0, MAX_PREVIOUS_VANTAGE_TOPICS)
                .flatMap(topic => previousTopicRefs(topic).slice(0, MAX_PREVIOUS_VANTAGE_REFS))
        ),
    ].sort();
    const parse = (ref: string) => {
        const match = /^(ev|obs|cm):([^\s]{1,64})$/.exec(ref);
        return match ? { kind: match[1]!, id: match[2]! } : null;
    };
    const ids = (kind: string) =>
        rawRefs.flatMap(ref => {
            const parsed = parse(ref);
            return parsed?.kind === kind ? [parsed.id] : [];
        });
    const [sourceEvidence, sourceObservations, sourceActions] = await Promise.all([
        ids("ev").length
            ? db
                  .select()
                  .from(evidence)
                  .where(and(eq(evidence.companyId, companyId), inArray(evidence.id, ids("ev"))))
                  .orderBy(asc(evidence.id))
            : Promise.resolve([]),
        ids("obs").length
            ? db
                  .select()
                  .from(observations)
                  .where(
                      and(
                          eq(observations.companyId, companyId),
                          inArray(observations.id, ids("obs"))
                      )
                  )
                  .orderBy(asc(observations.id))
            : Promise.resolve([]),
        ids("cm").length
            ? db
                  .select()
                  .from(commitments)
                  .where(
                      and(eq(commitments.companyId, companyId), inArray(commitments.id, ids("cm")))
                  )
                  .orderBy(asc(commitments.id))
            : Promise.resolve([]),
    ]);
    const cutoff = Date.parse(period.asOf);
    const cutoffDay = reportingDate(new Date(period.asOf));
    const afterCutoff = (item: {
        createdAt: Date;
        updatedAt?: Date | null;
        resolvedAt?: Date | null;
    }) =>
        item.createdAt.getTime() > cutoff ||
        (item.updatedAt?.getTime() ?? 0) > cutoff ||
        (item.resolvedAt?.getTime() ?? 0) > cutoff;
    const sourceStates: PreviousVantageSource[] = rawRefs.map(ref => {
        const parsed = parse(ref);
        if (!parsed)
            return {
                ref: "unsupported",
                status: "unsupported-ref",
                documentVerification: "unavailable",
            };
        const source =
            parsed.kind === "ev"
                ? sourceEvidence.find(item => item.id === parsed.id)
                : parsed.kind === "obs"
                  ? sourceObservations.find(item => item.id === parsed.id)
                  : sourceActions.find(item => item.id === parsed.id);
        if (
            !source ||
            (parsed.kind === "obs" &&
                !knownMetricIds.has((source as (typeof sourceObservations)[number]).metricId))
        )
            return {
                ref,
                status: "missing-or-unauthorized",
                documentVerification: "not-applicable",
            };
        const document = "kind" in source && source.kind === "document";
        const futureCoverage =
            ("observedAt" in source && source.observedAt > cutoffDay) ||
            ("periodEnd" in source &&
                (source.periodEnd > cutoffDay || source.periodStart > source.periodEnd));
        return {
            ref,
            status:
                afterCutoff(source) || futureCoverage
                    ? "after-cutoff"
                    : document
                      ? "document-verification-unavailable"
                      : "available",
            documentVerification: document ? "unavailable" : "not-applicable",
        };
    });
    const fingerprint = previousVantageFingerprint({
        actorId: actorId ?? null,
        report: row,
        topics: priorTopics,
        actions: priorActions,
        state: priorState,
        sourceEvidence,
        sourceObservations,
        sourceActions,
        sourceStates,
        sourceDefinitions: knownMetricDefinitions
            .filter(definition =>
                sourceObservations.some(observation => observation.metricId === definition.id)
            )
            .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    });
    return {
        report,
        reportAfterCutoff: afterCutoff(row) || (row.generatedAt?.getTime() ?? 0) > cutoff,
        pendingHistoricalState: pendingHistoricalState(priorState.data.pendingHistoricalQuestions),
        // Legacy three-argument readers remain valid, but cannot introduce actor-bound history.
        context: actorId
            ? assemblePreviousVantageContext({
                  currentPeriod: period,
                  report,
                  actions: priorActions.map(action => toCommitmentDto(action, null)),
                  sourceStates,
                  reportUpdatedAt: row.updatedAt?.toISOString() ?? null,
                  topicState: Object.fromEntries(
                      priorTopics.map(topic => [
                          topic.id,
                          {
                              createdAt: topic.createdAt.toISOString(),
                              updatedAt: topic.updatedAt?.toISOString() ?? null,
                          },
                      ])
                  ),
                  actionState: Object.fromEntries(
                      priorActions.map(action => [
                          action.id,
                          {
                              updatedAt: action.updatedAt?.toISOString() ?? null,
                          },
                      ])
                  ),
                  snapshotVersion: fingerprint,
              })
            : null,
        fingerprint,
    };
}
/** Exact-origin reads validate permissions/state only; question prose comes from the previous ledger. */
async function pendingHistoricalSnapshot(
    db: ReadDb,
    companyId: bigint,
    period: ReportPeriod,
    actorId: string | undefined,
    agenda: AgendaV1Dto | null,
    previous: Awaited<ReturnType<typeof previousVantageSnapshot>>
) {
    const current = agenda ? await state(db, companyId, agenda.id) : { version: 0, data: fresh() };
    const ledger = mergePendingHistoricalState({
        previous: previous.pendingHistoricalState,
        current: pendingHistoricalState(current.data.pendingHistoricalQuestions),
        previousReport: previous.report,
    });
    const candidates = ledger.questions.filter(question => !ledger.reviews[question.questionId]);
    async function batches<T>(
        values: string[],
        query: (batch: string[]) => PromiseLike<T[]>
    ): Promise<T[]> {
        const rows: T[] = [];
        for (let i = 0; i < values.length; i += PENDING_VALIDATION_BATCH_SIZE)
            rows.push(...(await query(values.slice(i, i + PENDING_VALIDATION_BATCH_SIZE))));
        return rows;
    }
    const reportIds = [...new Set(candidates.map(question => question.originReportId))];
    const topicIds = [...new Set(candidates.map(question => question.originTopicId))];
    const refs = [
        ...new Set(candidates.flatMap(question => question.sourceRefs.map(ref => ref.ref))),
    ].sort();
    const ids = (kind: string) =>
        refs.flatMap(ref => {
            const match = /^(ev|obs|cm):([^\s]{1,64})$/.exec(ref);
            return match?.[1] === kind ? [match[2]!] : [];
        });
    const [
        originReports,
        originTopics,
        originVersions,
        sourceEvidence,
        sourceObservations,
        sourceActions,
        sourceDefinitions,
    ] = await Promise.all([
        batches(reportIds, batch =>
            db
                .select({
                    id: agendas.id,
                    companyId: agendas.companyId,
                    weekStart: agendas.weekStart,
                    generatedAt: agendas.generatedAt,
                    createdAt: agendas.createdAt,
                    updatedAt: agendas.updatedAt,
                })
                .from(agendas)
                .where(and(eq(agendas.companyId, companyId), inArray(agendas.id, batch)))
                .orderBy(asc(agendas.id))
        ),
        batches(topicIds, batch =>
            db
                .select({
                    id: topics.id,
                    agendaId: topics.agendaId,
                    companyId: topics.companyId,
                    status: topics.status,
                    decidedAt: topics.decidedAt,
                    createdAt: topics.createdAt,
                    updatedAt: topics.updatedAt,
                })
                .from(topics)
                .where(and(eq(topics.companyId, companyId), inArray(topics.id, batch)))
                .orderBy(asc(topics.id))
        ),
        batches(reportIds, batch =>
            db
                .select({ agendaId: states.agendaId, version: states.version })
                .from(states)
                .where(and(eq(states.companyId, companyId), inArray(states.agendaId, batch)))
                .orderBy(asc(states.agendaId))
        ),
        batches(ids("ev"), batch =>
            db
                .select()
                .from(evidence)
                .where(and(eq(evidence.companyId, companyId), inArray(evidence.id, batch)))
                .orderBy(asc(evidence.id))
        ),
        batches(ids("obs"), batch =>
            db
                .select()
                .from(observations)
                .where(and(eq(observations.companyId, companyId), inArray(observations.id, batch)))
                .orderBy(asc(observations.id))
        ),
        batches(ids("cm"), batch =>
            db
                .select()
                .from(commitments)
                .where(and(eq(commitments.companyId, companyId), inArray(commitments.id, batch)))
                .orderBy(asc(commitments.id))
        ),
        ids("obs").length
            ? db
                  .select()
                  .from(definitions)
                  .where(eq(definitions.companyId, companyId))
                  .orderBy(asc(definitions.id))
            : Promise.resolve([]),
    ]);
    const cutoff = Date.parse(period.asOf),
        cutoffDay = reportingDate(new Date(period.asOf));
    const late = (value: Date | null | undefined) => !!value && value.getTime() > cutoff;
    const originAvailability: Record<string, PendingOriginAvailability> = {};
    for (const question of candidates) {
        const report = originReports.find(row => row.id === question.originReportId);
        const topic = originTopics.find(
            row => row.id === question.originTopicId && row.agendaId === question.originReportId
        );
        originAvailability[question.questionId] = previous.reportAfterCutoff
            ? "after-cutoff"
            : !report || !topic || report.weekStart !== question.originWeekStart
              ? "missing-or-unauthorized"
              : [
                      report.createdAt,
                      report.generatedAt,
                      report.updatedAt,
                      topic.createdAt,
                      topic.updatedAt,
                      topic.decidedAt,
                  ].some(late)
                ? "after-cutoff"
                : topic.status === "dismissed"
                  ? "dismissed"
                  : "available";
        if (originAvailability[question.questionId] === "dismissed")
            ledger.reviews[question.questionId] = {
                status: "dismissed",
                reviewedAt: (
                    topic!.updatedAt ??
                    topic!.decidedAt ??
                    new Date(period.asOf)
                ).toISOString(),
                reviewedBy: null,
                reason: "Explicit dismissal recorded on the original topic; original actor is not stored.",
            };
    }
    const sourceStates: PreviousVantageSource[] = refs.map(ref => {
        const match = /^(ev|obs|cm):([^\s]{1,64})$/.exec(ref);
        if (!match)
            return {
                ref: "unsupported",
                status: "unsupported-ref",
                documentVerification: "unavailable",
            };
        const source =
            match[1] === "ev"
                ? sourceEvidence.find(row => row.id === match[2])
                : match[1] === "obs"
                  ? sourceObservations.find(row => row.id === match[2])
                  : sourceActions.find(row => row.id === match[2]);
        const definition =
            source && "metricId" in source
                ? sourceDefinitions.find(row => row.id === source.metricId)
                : null;
        if (!source || ("metricId" in source && !definition))
            return {
                ref,
                status: "missing-or-unauthorized",
                documentVerification: "not-applicable",
            };
        const document = "kind" in source && source.kind === "document";
        const afterCutoff =
            late(source.createdAt) ||
            ("updatedAt" in source && late(source.updatedAt)) ||
            ("resolvedAt" in source && late(source.resolvedAt)) ||
            ("observedAt" in source && source.observedAt > cutoffDay) ||
            ("periodEnd" in source &&
                (source.periodEnd > cutoffDay || source.periodStart > source.periodEnd)) ||
            !!(definition && (late(definition.createdAt) || late(definition.updatedAt)));
        return {
            ref,
            status: afterCutoff
                ? "after-cutoff"
                : document
                  ? "document-verification-unavailable"
                  : "available",
            documentVerification: document ? "unavailable" : "not-applicable",
        };
    });
    const fingerprintState = {
        actorId: actorId ?? null,
        previousLedger: previous.pendingHistoricalState,
        currentLedger: current.data.pendingHistoricalQuestions ?? null,
        ledger,
        originReports,
        originTopics,
        originVersions,
        sourceEvidence,
        sourceObservations,
        sourceActions,
        sourceDefinitions,
    };
    const context = projectPendingHistoricalQuestions({
        state: ledger,
        originAvailability,
        sourceStates,
        asOf: period.asOf,
        currentWeekStart: period.weekStart,
        fingerprintState,
    });
    return {
        ledger,
        context: actorId ? context : null,
        fingerprint: context.snapshotVersion,
        currentVersion: current.version,
    };
}

async function generationSnapshotFromDb(
    companyId: bigint,
    period: ReportPeriod,
    mode: GenerationInput["generationMode"],
    db: ReadDb,
    actorId?: string
) {
    const endDate = reportingDate(new Date(period.endExclusive));
    const last = period.kind === "completed-week" ? calendarAdd(endDate, -1) : endDate;
    const [agenda, defs, ev, obs, cm] = await Promise.all([
        read(db, companyId, { weekStart: period.weekStart }),
        db
            .select()
            .from(definitions)
            .where(
                and(
                    eq(definitions.companyId, companyId),
                    lte(definitions.createdAt, new Date(period.asOf))
                )
            ),
        db
            .select()
            .from(evidence)
            .where(
                and(
                    eq(evidence.companyId, companyId),
                    gte(evidence.observedAt, period.weekStart),
                    lte(evidence.observedAt, last),
                    lte(evidence.createdAt, new Date(period.asOf))
                )
            ),
        db
            .select()
            .from(observations)
            .where(
                and(
                    eq(observations.companyId, companyId),
                    gte(observations.periodStart, calendarAdd(period.weekStart, -7)),
                    lte(observations.periodEnd, last),
                    lte(observations.createdAt, new Date(period.asOf))
                )
            ),
        db
            .select()
            .from(commitments)
            .where(
                and(
                    eq(commitments.companyId, companyId),
                    lte(commitments.createdAt, new Date(period.asOf))
                )
            ),
    ]);
    const names = new Map(defs.map(d => [d.id, d]));
    const previous = await previousVantageSnapshot(db, companyId, period, actorId, defs);
    const pending = await pendingHistoricalSnapshot(
        db,
        companyId,
        period,
        actorId,
        agenda,
        previous
    );
    const mapObs = (o: (typeof obs)[number]): MetricObservationDto => ({
        id: o.id,
        metricId: o.metricId,
        metricKey: names.get(o.metricId)?.key ?? "",
        metricName: names.get(o.metricId)?.name ?? "",
        value: o.value,
        periodStart: o.periodStart,
        periodEnd: o.periodEnd,
        source: o.source,
        note: o.note,
        createdAt: o.createdAt.toISOString(),
    });
    const input: GenerationInput = {
        contractVersion: "v1",
        runId: randomUUID(),
        inputVersion: "",
        reportPeriod: period,
        generationMode: mode,
        data: {
            metricDefinitions: defs.map(toDefinitionDto),
            currentEvidence: ev.map(toEvidenceDto),
            currentObservations: obs
                .filter(o => names.has(o.metricId) && o.periodStart >= period.weekStart)
                .map(mapObs),
            comparisonObservations: obs
                .filter(
                    o =>
                        names.has(o.metricId) &&
                        o.periodStart >= calendarAdd(period.weekStart, -7) &&
                        o.periodEnd <= calendarAdd(last, -7)
                )
                .map(mapObs),
            resolvedCommitments: cm
                .filter(
                    c =>
                        c.status !== "open" &&
                        c.resolvedAt &&
                        c.resolvedAt.toISOString() >= period.startInclusive &&
                        c.resolvedAt.toISOString() < period.endExclusive
                )
                .map(c => toCommitmentDto(c, null)),
            carryForwardCommitments: cm
                .filter(c => c.status === "open" && c.dueOn <= last)
                .map(c => toCommitmentDto(c, null)),
        },
        reviewedTopics: (agenda?.topics ?? [])
            .filter(
                t =>
                    t.origin === "founder" ||
                    t.commitmentId !== null ||
                    t.status !== "suggested" ||
                    t.decision !== null ||
                    t.contentVersion > 1
            )
            .map(topic => ({ topic, contentVersion: topic.contentVersion })),
        previousVantageContext: previous.context,
        pendingHistoricalQuestions: pending.context,
    };
    input.inputVersion = fingerprint({
        period: input.reportPeriod,
        data: input.data,
        reviewedTopics: input.reviewedTopics,
        previousVantageContext: input.previousVantageContext,
        previousVantageStateFingerprint: previous.fingerprint,
        ...(actorId
            ? {
                  pendingHistoricalQuestions: input.pendingHistoricalQuestions,
                  pendingHistoricalStateFingerprint: pending.fingerprint,
              }
            : {}),
        actorId: actorId ?? null,
    });
    return {
        input,
        expectedReportFingerprint: fingerprint(agenda),
        actorId,
        pendingHistoricalState: pending.ledger,
    };
}
export async function generationSnapshot(
    companyId: bigint,
    period: ReportPeriod,
    mode: GenerationInput["generationMode"],
    options: { actorId?: string } = {}
) {
    return generationSnapshotFromDb(companyId, period, mode, getDb(), options.actorId);
}

async function pendingViewFromDb(
    db: ReadDb,
    args: { companyId: bigint; agendaId: string; actorId: string }
) {
    if (!args.actorId) throw new VantageError("An authorized actor is required.", 403, "forbidden");
    const agenda = await read(db, args.companyId, { id: args.agendaId });
    if (!agenda) throw new VantageError("That report is not here.", 404, "not_found");
    const savedPeriod = agenda.reportPeriod ?? reportPeriod(new Date(), agenda.weekStart);
    // A later human review is visible immediately; the source/content cutoff still fails closed.
    const period = {
        ...savedPeriod,
        asOf: new Date(Math.max(Date.now(), Date.parse(savedPeriod.asOf))).toISOString(),
    };
    const defs = await db
        .select()
        .from(definitions)
        .where(
            and(
                eq(definitions.companyId, args.companyId),
                lte(definitions.createdAt, new Date(period.asOf))
            )
        );
    const previous = await previousVantageSnapshot(db, args.companyId, period, args.actorId, defs);
    const pending = await pendingHistoricalSnapshot(
        db,
        args.companyId,
        period,
        args.actorId,
        agenda,
        previous
    );
    const view: PendingHistoricalQuestionsViewV1 = {
        contractVersion: PENDING_QUESTIONS_CONTRACT,
        agendaId: agenda.id,
        version: pending.currentVersion,
        questions: pending.context!.questions,
        unavailableCount: pending.context!.unavailableCount,
    };
    return { view, pending, agenda };
}

/** Additive, actor-bound section; existing report/overview DTOs are unchanged. */
export async function getPendingHistoricalQuestionsV1(args: {
    companyId: bigint;
    agendaId: string;
    actorId: string;
}): Promise<PendingHistoricalQuestionsViewV1> {
    return (await pendingViewFromDb(getDb(), args)).view;
}

/** Human-only terminal review updates this report's lineage, never an older topic or action. */
export async function reviewPendingHistoricalQuestionV1(args: {
    companyId: bigint;
    userId: string;
    agendaId: string;
    questionId: string;
    expectedVersion: number;
    status: "dismissed" | "addressed";
    reason?: string | null;
}): Promise<PendingHistoricalQuestionsViewV1> {
    if (
        !args.userId ||
        !Number.isInteger(args.expectedVersion) ||
        args.expectedVersion < 0 ||
        !["dismissed", "addressed"].includes(args.status)
    )
        throw new VantageError(
            "Provide an actor, report version and human review status.",
            400,
            "validation_error"
        );
    return getDb().transaction(async tx => {
        await lock(tx);
        const current = await pendingViewFromDb(tx, {
            companyId: args.companyId,
            agendaId: args.agendaId,
            actorId: args.userId,
        });
        if (current.view.version !== args.expectedVersion)
            throw new VantageError(
                "Pending questions changed. Reload before reviewing.",
                409,
                "stale_agenda"
            );
        if (!current.view.questions.some(question => question.questionId === args.questionId))
            throw new VantageError("That pending question is unavailable.", 404, "not_found");
        const s = await state(tx, args.companyId, args.agendaId);
        const pending = current.pending.ledger;
        pending.reviews[args.questionId] = {
            status: args.status,
            reviewedAt: new Date().toISOString(),
            reviewedBy: args.userId,
            reason: orNull(args.reason),
        };
        s.data.pendingHistoricalQuestions = pending;
        await putState(tx, args.companyId, args.agendaId, s.version + 1, s.data);
        return (
            await pendingViewFromDb(tx, {
                companyId: args.companyId,
                agendaId: args.agendaId,
                actorId: args.userId,
            })
        ).view;
    });
}

export async function saveGeneration(
    companyId: bigint,
    userId: string,
    snapshot: Awaited<ReturnType<typeof generationSnapshot>>,
    result: GenerationResult
) {
    if (snapshot.actorId && snapshot.actorId !== userId)
        throw new VantageError("Generation actor changed.", 403, "generation_failed");
    return getDb().transaction(async tx => {
        await lock(tx);
        // Re-read every source collection after taking the short write lock.
        // The model call happens before this transaction; only the final
        // context check and persistence are serialized with other writers.
        const currentSnapshot = await generationSnapshotFromDb(
            companyId,
            snapshot.input.reportPeriod,
            snapshot.input.generationMode,
            tx,
            snapshot.actorId
        );
        if (currentSnapshot.expectedReportFingerprint !== snapshot.expectedReportFingerprint)
            throw new VantageError(
                "Report changed during generation. Reload and generate again.",
                409,
                "stale_agenda"
            );
        if (currentSnapshot.input.inputVersion !== snapshot.input.inputVersion)
            throw new VantageError(
                "Source data changed during generation. Reload and generate again.",
                409,
                "stale_context"
            );
        let current = await read(tx, companyId, {
            weekStart: snapshot.input.reportPeriod.weekStart,
        });
        if (fingerprint(current) !== snapshot.expectedReportFingerprint)
            throw new VantageError(
                "Report changed during generation. Reload and generate again.",
                409,
                "stale_agenda"
            );
        const agendaId = current?.id ?? randomUUID();
        if (!current?.id) {
            await tx.insert(agendas).values({
                id: agendaId,
                companyId,
                createdByUserId: userId,
                weekStart: snapshot.input.reportPeriod.weekStart,
            });
            current = await read(tx, companyId, { id: agendaId });
        }
        const s = await state(tx, companyId, agendaId);
        if (snapshot.actorId)
            s.data.pendingHistoricalQuestions = currentSnapshot.pendingHistoricalState;
        const replaceable = (current?.topics ?? [])
            .filter(
                t =>
                    t.origin !== "founder" &&
                    t.status === "suggested" &&
                    t.decision === null &&
                    t.commitmentId === null &&
                    t.contentVersion === 1
            )
            .map(t => t.id);
        if (replaceable.length)
            await tx
                .delete(topics)
                .where(and(eq(topics.companyId, companyId), inArray(topics.id, replaceable)));
        let position = Math.max(-1, ...(current?.topics ?? []).map(t => t.position)) + 1;
        for (const t of result.draft.topics) {
            const id = randomUUID();
            await tx.insert(topics).values({
                id,
                companyId,
                agendaId,
                position: position++,
                ...t,
                status: "suggested",
                origin: result.draft.origin,
                shared: false,
            });
            s.data.topicVersions[id] = 1;
        }
        for (const id of replaceable) delete s.data.topicVersions[id];
        s.data.period = snapshot.input.reportPeriod;
        s.data.execution = result.execution;
        s.data.enhancements.push(
            ...result.enhancements.map(c => ({
                ...c,
                id: randomUUID(),
                status: "suggested" as const,
                createdAt: new Date().toISOString(),
            }))
        );
        await tx
            .update(agendas)
            .set({
                summary: result.draft.summary,
                signals: result.signals as unknown as Record<string, unknown>,
                modelMetadata: result.draft.modelMetadata,
                generatedAt: new Date(),
            })
            .where(and(eq(agendas.companyId, companyId), eq(agendas.id, agendaId)));
        await putState(tx, companyId, agendaId, s.version + 1, s.data);
        return (await read(tx, companyId, { id: agendaId }))!;
    });
}
async function ownedTopic(tx: Tx, companyId: bigint, id: string) {
    const [row] = await tx
        .select()
        .from(topics)
        .where(and(eq(topics.companyId, companyId), eq(topics.id, id)));
    if (!row) throw new VantageError("That topic is not here.", 404, "not_found");
    return row;
}
export async function patchTopicV1(
    companyId: bigint,
    id: string,
    patch: Partial<TopicInput> & {
        status?: "suggested" | "kept" | "dismissed";
        expectedContentVersion?: number;
    }
): Promise<TopicV1Dto> {
    return getDb().transaction(async tx => {
        await lock(tx);
        const row = await ownedTopic(tx, companyId, id),
            s = await state(tx, companyId, row.agendaId);
        const expectedContentVersion = patch.expectedContentVersion;
        if (
            typeof expectedContentVersion !== "number" ||
            !Number.isInteger(expectedContentVersion) ||
            expectedContentVersion <= 0
        )
            throw new VantageError(
                "expectedContentVersion must be a positive integer.",
                400,
                "validation_error"
            );
        if (expectedContentVersion !== (s.data.topicVersions[id] ?? 1))
            throw new VantageError(
                "Topic changed. Reload before saving your edit.",
                409,
                "stale_topic"
            );
        if (patch.shared) throw new VantageError("Sharing is disabled.", 400, "validation_error");
        const { expectedContentVersion: _expectedContentVersion, ...contentPatch } = patch;
        const normalized = { ...contentPatch };
        for (const key of ["proposedOwner", "proposedDue", "helpRequested", "rationale"] as const)
            if (normalized[key] !== undefined) normalized[key] = orNull(normalized[key]);
        const edited = Object.keys(contentPatch).some(k => k !== "status");
        if (Object.keys(contentPatch).length === 0)
            return (await read(tx, companyId, { id: row.agendaId }))!.topics.find(
                t => t.id === id
            )!;
        await tx
            .update(topics)
            .set({
                ...normalized,
                status: contentPatch.status ?? (edited ? "kept" : row.status),
            })
            .where(and(eq(topics.companyId, companyId), eq(topics.id, id)));
        s.data.topicVersions[id] = (s.data.topicVersions[id] ?? 1) + 1;
        await putState(tx, companyId, row.agendaId, s.version + 1, s.data);
        return (await read(tx, companyId, { id: row.agendaId }))!.topics.find(t => t.id === id)!;
    });
}
export async function decideV1(args: {
    companyId: bigint;
    userId: string;
    topicId: string;
    key: string;
    decision: string;
    commitment: {
        title: string;
        owner: string;
        dueOn: string;
        test?: string | null;
        shared?: boolean;
    } | null;
}) {
    if (args.commitment) validateAction(args.commitment);
    return getDb().transaction(async tx => {
        await lock(tx);
        const row = await ownedTopic(tx, args.companyId, args.topicId),
            s = await state(tx, args.companyId, row.agendaId);
        const action = args.commitment
            ? {
                  title: args.commitment.title.trim(),
                  owner: args.commitment.owner.trim(),
                  dueOn: args.commitment.dueOn,
                  test: orNull(args.commitment.test),
                  shared: false,
              }
            : null;
        const decision = args.decision.trim(),
            hash = fingerprint({ decision, commitment: action });
        const key = JSON.stringify([args.userId, args.topicId, args.key]);
        const previous = s.data.submissions[key];
        if (previous && previous.hash !== hash)
            throw new VantageError(
                "Submission key was used with different content.",
                409,
                "idempotency_conflict"
            );
        if (previous)
            return (await read(tx, args.companyId, { id: row.agendaId }))!.topics.find(
                t => t.id === row.id
            )!;
        const links = await tx
            .select()
            .from(commitments)
            .where(and(eq(commitments.companyId, args.companyId), eq(commitments.topicId, row.id)));
        if (links.length > 1)
            throw new VantageError(
                "Ambiguous linked actions need review.",
                409,
                "commitment_ambiguous"
            );
        if (
            action &&
            links[0] &&
            fingerprint(action) !==
                fingerprint({
                    title: links[0].title,
                    owner: links[0].owner,
                    dueOn: links[0].dueOn,
                    test: links[0].test,
                    shared: links[0].shared,
                })
        )
            throw new VantageError(
                "Edit the existing primary action instead.",
                409,
                "commitment_exists"
            );
        if (action && !links.length)
            await tx.insert(commitments).values({
                id: randomUUID(),
                companyId: args.companyId,
                createdByUserId: args.userId,
                agendaId: row.agendaId,
                topicId: row.id,
                ...action,
            });
        if (row.decision !== decision || row.status !== "kept") {
            await tx
                .update(topics)
                .set({
                    decision,
                    status: "kept",
                    decidedAt: row.decision === decision ? row.decidedAt : new Date(),
                })
                .where(and(eq(topics.companyId, args.companyId), eq(topics.id, row.id)));
            s.data.topicVersions[row.id] = (s.data.topicVersions[row.id] ?? 1) + 1;
        }
        s.data.submissions[key] = { hash, topicId: row.id };
        await putState(tx, args.companyId, row.agendaId, s.version + 1, s.data);
        return (await read(tx, args.companyId, { id: row.agendaId }))!.topics.find(
            t => t.id === row.id
        )!;
    });
}
export async function reviewEnhancement(
    companyId: bigint,
    topicId: string,
    id: string,
    status: EnhancementDto["status"],
    baseTopicVersion: number
) {
    return getDb().transaction(async tx => {
        await lock(tx);
        const topic = await ownedTopic(tx, companyId, topicId),
            s = await state(tx, companyId, topic.agendaId);
        const candidate = s.data.enhancements.find(e => e.id === id && e.topicId === topicId);
        if (!candidate) throw new VantageError("That enhancement is not here.", 404, "not_found");
        if (candidate.status === status)
            return { enhancement: candidate, agendaVersion: s.version };
        if (candidate.status !== "suggested")
            throw new VantageError(
                "Enhancement was already reviewed.",
                409,
                "enhancement_finalized"
            );
        if (
            baseTopicVersion !== candidate.baseTopicVersion ||
            baseTopicVersion !== (s.data.topicVersions[topicId] ?? 1)
        )
            throw new VantageError(
                "Original topic changed. Review a fresh suggestion.",
                409,
                "stale_topic"
            );
        candidate.status = status;
        await putState(tx, companyId, topic.agendaId, s.version + 1, s.data);
        return { enhancement: candidate, agendaVersion: s.version + 1 };
    });
}

export async function createObservationsV1(args: {
    companyId: bigint;
    userId: string;
    inputs: ObservationInput[];
}) {
    const ids = [...new Set(args.inputs.map(o => o.metricId))];
    if (ids.length) {
        const found = await getDb()
            .select({ id: definitions.id })
            .from(definitions)
            .where(and(eq(definitions.companyId, args.companyId), inArray(definitions.id, ids)));
        if (found.length !== ids.length)
            throw new VantageError("That metric is not here.", 404, "not_found");
    }
    return createObservations(args);
}
function validateAction(
    action: Pick<CommitmentInput, "title" | "owner" | "dueOn" | "test" | "shared">
) {
    if (
        !action.title.trim() ||
        !action.owner.trim() ||
        !validDate(action.dueOn) ||
        !orNull(action.test) ||
        action.shared
    )
        throw new VantageError(
            "An action needs a title, owner, date and acceptance test; sharing is disabled.",
            400,
            "validation_error"
        );
}
async function ownedAgenda(tx: Tx, companyId: bigint, id: string) {
    const agenda = await read(tx, companyId, { id });
    if (!agenda) throw new VantageError("That agenda is not here.", 404, "not_found");
    return agenda;
}
async function touchAgenda(tx: Tx, companyId: bigint, agendaId: string, topicId?: string) {
    const s = await state(tx, companyId, agendaId);
    if (topicId) s.data.topicVersions[topicId] = (s.data.topicVersions[topicId] ?? 1) + 1;
    await putState(tx, companyId, agendaId, s.version + 1, s.data);
}
export async function addTopicV1(args: { companyId: bigint; agendaId: string; input: TopicInput }) {
    return getDb().transaction(async tx => {
        await lock(tx);
        const agenda = await ownedAgenda(tx, args.companyId, args.agendaId);
        if (args.input.shared)
            throw new VantageError("Sharing is disabled.", 400, "validation_error");
        const id = randomUUID();
        await tx.insert(topics).values({
            ...args.input,
            id,
            companyId: args.companyId,
            agendaId: args.agendaId,
            position: Math.max(-1, ...agenda.topics.map(t => t.position)) + 1,
            origin: "founder",
            status: "kept",
            shared: false,
            title: args.input.title.trim(),
            proposedOwner: orNull(args.input.proposedOwner),
            proposedDue: orNull(args.input.proposedDue),
            helpRequested: orNull(args.input.helpRequested),
            rationale: orNull(args.input.rationale),
        });
        const s = await state(tx, args.companyId, args.agendaId);
        s.data.topicVersions[id] = 1;
        await putState(tx, args.companyId, args.agendaId, s.version + 1, s.data);
        return (await read(tx, args.companyId, { id: args.agendaId }))!.topics.find(
            t => t.id === id
        )!;
    });
}
export async function reorderTopicsV1(args: {
    companyId: bigint;
    agendaId: string;
    ids: string[];
}) {
    return getDb().transaction(async tx => {
        await lock(tx);
        const agenda = await ownedAgenda(tx, args.companyId, args.agendaId);
        const owned = new Set(agenda.topics.map(t => t.id));
        if (new Set(args.ids).size !== args.ids.length || args.ids.some(id => !owned.has(id)))
            throw new VantageError(
                "Reorder only distinct topics from this agenda.",
                400,
                "validation_error"
            );
        const ordered = [
            ...args.ids,
            ...agenda.topics.map(t => t.id).filter(id => !args.ids.includes(id)),
        ];
        for (const [position, id] of ordered.entries())
            await tx
                .update(topics)
                .set({ position })
                .where(and(eq(topics.companyId, args.companyId), eq(topics.id, id)));
        if (ordered.some((id, i) => agenda.topics[i]?.id !== id))
            await touchAgenda(tx, args.companyId, args.agendaId);
        return (await read(tx, args.companyId, { id: args.agendaId }))!;
        return (await read(tx, args.companyId, { id: args.agendaId }))!;
    });
}
export async function setAgendaStatusV1(args: {
    companyId: bigint;
    id: string;
    status: VantageAgendaStatus;
}) {
    return getDb().transaction(async tx => {
        await lock(tx);
        const agenda = await ownedAgenda(tx, args.companyId, args.id);
        if (agenda.status !== args.status) {
            await tx
                .update(agendas)
                .set({
                    status: args.status,
                    ...(args.status === "held" ? { heldAt: new Date() } : {}),
                })
                .where(and(eq(agendas.companyId, args.companyId), eq(agendas.id, args.id)));
            await touchAgenda(tx, args.companyId, args.id);
        }
        return (await read(tx, args.companyId, { id: args.id }))!;
    });
}
export async function clearDecisionV1(args: {
    companyId: bigint;
    topicId: string;
    commitmentId?: string | null;
}) {
    return getDb().transaction(async tx => {
        await lock(tx);
        const topic = await ownedTopic(tx, args.companyId, args.topicId);
        if (args.commitmentId) {
            const deleted = await tx
                .delete(commitments)
                .where(
                    and(
                        eq(commitments.companyId, args.companyId),
                        eq(commitments.topicId, topic.id),
                        eq(commitments.id, args.commitmentId)
                    )
                )
                .returning();
            if (!deleted.length)
                throw new VantageError("That action is not linked here.", 404, "not_found");
        }
        if (topic.decision !== null || args.commitmentId) {
            await tx
                .update(topics)
                .set({ decision: null, decidedAt: null })
                .where(and(eq(topics.companyId, args.companyId), eq(topics.id, topic.id)));
            await touchAgenda(tx, args.companyId, topic.agendaId, topic.id);
        }
        return (await read(tx, args.companyId, { id: topic.agendaId }))!.topics.find(
            t => t.id === topic.id
        )!;
    });
}
export async function deleteTopicV1(args: { companyId: bigint; id: string }) {
    return getDb().transaction(async tx => {
        await lock(tx);
        const topic = await ownedTopic(tx, args.companyId, args.id);
        await tx
            .delete(topics)
            .where(and(eq(topics.companyId, args.companyId), eq(topics.id, args.id)));
        const s = await state(tx, args.companyId, topic.agendaId);
        delete s.data.topicVersions[args.id];
        s.data.enhancements = s.data.enhancements.filter(e => e.topicId !== args.id);
        await putState(tx, args.companyId, topic.agendaId, s.version + 1, s.data);
    });
}
async function ownedCommitment(tx: Tx, companyId: bigint, id: string) {
    const [row] = await tx
        .select()
        .from(commitments)
        .where(and(eq(commitments.companyId, companyId), eq(commitments.id, id)));
    if (!row) throw new VantageError("That action is not here.", 404, "not_found");
    if (row.topicId) {
        const topic = await ownedTopic(tx, companyId, row.topicId);
        if (row.agendaId !== topic.agendaId)
            throw new VantageError("Action links need review.", 409, "commitment_ambiguous");
    }
    if (row.agendaId) await ownedAgenda(tx, companyId, row.agendaId);
    return row;
}
export async function createCommitmentV1(args: {
    companyId: bigint;
    userId: string;
    input: CommitmentInput;
}): Promise<CommitmentDto> {
    validateAction(args.input);
    return getDb().transaction(async tx => {
        await lock(tx);
        let agendaId = args.input.agendaId ?? null;
        let topicTitle: string | null = null;
        if (args.input.topicId) {
            const topic = await ownedTopic(tx, args.companyId, args.input.topicId);
            if (agendaId && agendaId !== topic.agendaId) {
                await ownedAgenda(tx, args.companyId, agendaId);
                throw new VantageError("Topic and agenda do not match.", 400, "validation_error");
            }
            agendaId = topic.agendaId;
            topicTitle = topic.title;
            const existing = await tx
                .select({ id: commitments.id })
                .from(commitments)
                .where(
                    and(
                        eq(commitments.companyId, args.companyId),
                        eq(commitments.topicId, topic.id)
                    )
                );
            if (existing.length)
                throw new VantageError(
                    "This topic already has a primary action.",
                    409,
                    existing.length > 1 ? "commitment_ambiguous" : "commitment_exists"
                );
        }
        if (agendaId) await ownedAgenda(tx, args.companyId, agendaId);
        const [row] = await tx
            .insert(commitments)
            .values({
                id: randomUUID(),
                companyId: args.companyId,
                createdByUserId: args.userId,
                agendaId,
                topicId: args.input.topicId ?? null,
                title: args.input.title.trim(),
                owner: args.input.owner.trim(),
                dueOn: args.input.dueOn,
                test: orNull(args.input.test),
                shared: false,
            })
            .returning();
        if (agendaId)
            await touchAgenda(tx, args.companyId, agendaId, args.input.topicId ?? undefined);
        return toCommitmentDto(row!, topicTitle);
    });
}
export async function updateCommitmentV1(args: {
    companyId: bigint;
    id: string;
    patch: {
        title?: string;
        owner?: string;
        dueOn?: string;
        test?: string | null;
        shared?: boolean;
        status?: VantageCommitmentStatus;
        outcome?: string | null;
    };
}): Promise<CommitmentDto> {
    return getDb().transaction(async tx => {
        await lock(tx);
        const row = await ownedCommitment(tx, args.companyId, args.id),
            p = args.patch;
        if (p.shared || (p.test !== undefined && !orNull(p.test)))
            throw new VantageError(
                "An action needs an acceptance test; sharing is disabled.",
                400,
                "validation_error"
            );
        const status = p.status ?? row.status,
            outcome = p.outcome === undefined ? row.outcome : orNull(p.outcome);
        if (status !== "open" && !outcome)
            throw new VantageError(
                "Record an outcome before resolving the action.",
                400,
                "validation_error"
            );
        if (!Object.keys(p).length) return toCommitmentDto(row, null);
        const [updated] = await tx
            .update(commitments)
            .set({
                ...p,
                outcome,
                ...(p.title !== undefined ? { title: p.title.trim() } : {}),
                ...(p.owner !== undefined ? { owner: p.owner.trim() } : {}),
                ...(p.test !== undefined ? { test: orNull(p.test) } : {}),
                ...(p.status !== undefined
                    ? {
                          resolvedAt:
                              status === "open"
                                  ? null
                                  : row.status === status
                                    ? row.resolvedAt
                                    : new Date(),
                      }
                    : {}),
            })
            .where(and(eq(commitments.companyId, args.companyId), eq(commitments.id, args.id)))
            .returning();
        if (row.agendaId)
            await touchAgenda(tx, args.companyId, row.agendaId, row.topicId ?? undefined);
        return toCommitmentDto(updated!, null);
    });
}
export async function deleteCommitmentV1(args: { companyId: bigint; id: string }) {
    return getDb().transaction(async tx => {
        await lock(tx);
        const row = await ownedCommitment(tx, args.companyId, args.id);
        await tx
            .delete(commitments)
            .where(and(eq(commitments.companyId, args.companyId), eq(commitments.id, args.id)));
        if (row.agendaId)
            await touchAgenda(tx, args.companyId, row.agendaId, row.topicId ?? undefined);
    });
}
export async function listCommitmentsV1(args: {
    companyId: bigint;
    status?: VantageCommitmentStatus[];
    agendaId?: string;
    sharedOnly?: boolean;
}): Promise<CommitmentDto[]> {
    const conditions = [eq(commitments.companyId, args.companyId)];
    if (args.status?.length) conditions.push(inArray(commitments.status, args.status));
    if (args.agendaId) conditions.push(eq(commitments.agendaId, args.agendaId));
    if (args.sharedOnly) conditions.push(eq(commitments.shared, true));
    const rows = await getDb()
        .select({ row: commitments, title: topics.title })
        .from(commitments)
        .leftJoin(
            topics,
            and(eq(topics.id, commitments.topicId), eq(topics.companyId, args.companyId))
        )
        .where(and(...conditions))
        .orderBy(asc(commitments.dueOn), desc(commitments.createdAt));
    return rows.map(({ row, title }) => toCommitmentDto(row, title ?? null));
}
