import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "@launchstack/store/client";
import {
    VantageError,
    orNull,
    toCommitmentDto,
    toDefinitionDto,
    toEvidenceDto,
    toTopicDto,
    type TopicInput,
} from "./db";
import {
    vantageAgendas as agendas,
    vantageAgendaTopics as topics,
    vantageCommitments as commitments,
    vantageContractState as states,
    vantageEvidence as evidence,
    vantageMetricDefinitions as definitions,
    vantageMetricObservations as observations,
} from "./schema";
import type {
    AgendaV1Dto,
    EnhancementDto,
    GenerationInput,
    GenerationResult,
    ReportPeriod,
    TopicV1Dto,
} from "./contract-v1";
import type { MetricObservationDto, WeeklySignals } from "./types";
import { calendarAdd, reportingDate } from "./period-v1";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type ReadDb = Pick<Db, "select">;
interface State {
    period?: ReportPeriod;
    execution?: GenerationResult["execution"];
    topicVersions: Record<string, number>;
    enhancements: EnhancementDto[];
    submissions: Record<string, { hash: string; topicId: string }>;
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
/** Short test-pilot write lock also serializes legacy writers, never model calls. */
async function lock(tx: Tx) {
    await tx.execute(
        sql`LOCK TABLE ${agendas}, ${topics}, ${commitments}, ${states} IN SHARE ROW EXCLUSIVE MODE`
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
            .where(and(eq(commitments.companyId, companyId), eq(commitments.agendaId, row.id))),
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
export async function generationSnapshot(
    companyId: bigint,
    period: ReportPeriod,
    mode: GenerationInput["generationMode"]
) {
    const db = getDb(),
        endDate = reportingDate(new Date(period.endExclusive));
    const last = period.kind === "completed-week" ? calendarAdd(endDate, -1) : endDate;
    const [agenda, defs, ev, obs, cm] = await Promise.all([
        read(db, companyId, { weekStart: period.weekStart }),
        db.select().from(definitions).where(eq(definitions.companyId, companyId)),
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
            currentObservations: obs.filter(o => o.periodStart >= period.weekStart).map(mapObs),
            comparisonObservations: obs
                .filter(
                    o =>
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
                    t.status !== "suggested" ||
                    t.decision !== null ||
                    t.contentVersion > 1
            )
            .map(topic => ({ topic, contentVersion: topic.contentVersion })),
    };
    input.inputVersion = fingerprint({
        period: input.reportPeriod,
        data: input.data,
        reviewedTopics: input.reviewedTopics,
    });
    return { input, expectedReportFingerprint: fingerprint(agenda) };
}
export async function saveGeneration(
    companyId: bigint,
    userId: string,
    snapshot: Awaited<ReturnType<typeof generationSnapshot>>,
    result: GenerationResult
) {
    return getDb().transaction(async tx => {
        await lock(tx);
        let current = await read(tx, companyId, {
            weekStart: snapshot.input.reportPeriod.weekStart,
        });
        if (fingerprint(current) !== snapshot.expectedReportFingerprint)
            throw new VantageError(
                "Report changed during generation. Reload and generate again.",
                409,
                "stale_agenda"
            );
        let agendaId = current?.id;
        if (!agendaId) {
            agendaId = randomUUID();
            await tx.insert(agendas).values({
                id: agendaId,
                companyId,
                createdByUserId: userId,
                weekStart: snapshot.input.reportPeriod.weekStart,
            });
            current = await read(tx, companyId, { id: agendaId });
        }
        const s = await state(tx, companyId, agendaId);
        const replaceable = (current?.topics ?? [])
            .filter(
                t =>
                    t.origin !== "founder" &&
                    t.status === "suggested" &&
                    t.decision === null &&
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
    patch: Partial<TopicInput> & { status?: "suggested" | "kept" | "dismissed" }
): Promise<TopicV1Dto> {
    return getDb().transaction(async tx => {
        await lock(tx);
        const row = await ownedTopic(tx, companyId, id),
            s = await state(tx, companyId, row.agendaId);
        const edited = Object.keys(patch).some(k => k !== "status");
        if (Object.keys(patch).length === 0)
            return (await read(tx, companyId, { id: row.agendaId }))!.topics.find(
                t => t.id === id
            )!;
        await tx
            .update(topics)
            .set({ ...patch, status: patch.status ?? (edited ? "kept" : row.status) })
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
