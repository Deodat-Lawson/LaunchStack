/** Opt-in real PostgreSQL tests. Generation results are fixtures, never AI calls. */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { configureDatabase, createDb } from "@launchstack/store/client";
import { company } from "@launchstack/store/schema";
import {
    vantageAgendas as agendas,
    vantageAgendaTopics as agendaTopics,
    vantageCommitments as actions,
    vantageContractState as states,
    vantageEvidence as evidence,
    vantageMetricDefinitions as definitions,
    vantageMetricObservations as observations,
} from "./schema";
import {
    addTopicV1,
    clearDecisionV1,
    createCommitmentV1,
    createObservationsV1,
    decideV1,
    deleteCommitmentV1,
    deleteTopicV1,
    fingerprint,
    generationSnapshot,
    getPendingHistoricalQuestionsV1,
    getAgendaV1,
    listCommitmentsV1,
    patchTopicV1,
    reorderTopicsV1,
    reviewEnhancement,
    reviewPendingHistoricalQuestionV1,
    saveGeneration,
    setAgendaStatusV1,
    updateCommitmentV1,
} from "./repository-v1";
import { getCommitment, getEvidence, getObservation } from "./db";
import { reportPeriod } from "./period-v1";
import { previousVantageFingerprint } from "./previous-context-v1";
import type { GenerationResult } from "./contract-v1";

const target = process.env.VANTAGE_TL_TEST_DATABASE_URL;
describe.skipIf(!target)("Contract v1 real PostgreSQL persistence", () => {
    let connection: ReturnType<typeof createDb>;
    let ours: bigint, other: bigint;
    const userId = "tl-synthetic-operator";
    const period = reportPeriod(new Date("2026-10-16T18:00:00.000Z"));
    const action = {
        title: "Run five interviews",
        owner: "Founder",
        dueOn: "2026-10-16",
        test: "Five interview notes recorded",
    };
    beforeAll(async () => {
        const url = new URL(target!);
        if (
            url.hostname !== "127.0.0.1" ||
            url.port !== "55437" ||
            url.pathname !== "/vantage_week2_tl_contract_v1"
        )
            throw new Error(
                "Refusing integration tests outside the dedicated local TL verification database."
            );
        connection = createDb({ url: target!, maxConnections: 10 });
        configureDatabase(connection.db);
        const [identity] = await connection.client`SELECT current_database() AS name`;
        expect(identity!.name).toBe("vantage_week2_tl_contract_v1");
    });
    beforeEach(async () => {
        const rows = await connection.db
            .insert(company)
            .values([
                { name: `TL integration ${randomUUID()}`, numberOfEmployees: "1" },
                { name: `Other integration ${randomUUID()}`, numberOfEmployees: "1" },
            ])
            .returning();
        ours = BigInt(rows[0]!.id);
        other = BigInt(rows[1]!.id);
    });
    afterEach(async () => {
        if (ours) await connection.db.delete(company).where(eq(company.id, Number(ours)));
        if (other) await connection.db.delete(company).where(eq(company.id, Number(other)));
    });
    afterAll(async () => {
        if (connection) await connection.close();
    });
    const snapshot = () => generationSnapshot(ours, period, "rules");
    function result(
        s: Awaited<ReturnType<typeof snapshot>>,
        title = "Discuss conversion"
    ): GenerationResult {
        return {
            runId: s.input.runId,
            inputVersion: s.input.inputVersion,
            draft: {
                summary: "Synthetic persistence fixture",
                origin: "rules",
                modelMetadata: { mode: "rules" },
                topics: [
                    {
                        title,
                        facts: [],
                        whyItMatters: "Review the evidence",
                        decisionQuestion: "What should we do?",
                        proposedNextStep: "Interview users",
                        proposedOwner: null,
                        proposedDue: null,
                        helpRequested: null,
                        unknowns: [],
                        conflicts: [],
                        rationale: "Test fixture",
                    },
                ],
            },
            signals: {
                weekStart: period.weekStart,
                since: period.weekStart,
                computedAt: period.asOf,
                metricChanges: [],
                metricConflicts: [],
                metricsWithoutData: [],
                newEvidence: [],
                recentEvidenceIds: [],
                overdueCommitmentIds: [],
                dueThisWeekCommitmentIds: [],
                resolvedCommitmentIds: [],
                daysSinceLastEntry: null,
            },
            enhancements: [],
            execution: {
                outcome: "generated",
                mode: "rules",
                fallbackReason: null,
                modelId: null,
                promptVersion: "synthetic-storage-test",
                attempts: 0,
                durationMs: 0,
            },
        };
    }
    async function generated() {
        const s = await snapshot();
        return saveGeneration(ours, userId, s, result(s));
    }
    const decision = (topicId: string, key = "submission-one") =>
        decideV1({
            companyId: ours,
            userId,
            topicId,
            key,
            decision: "Interview five users",
            commitment: action,
        });

    async function previousReport(
        options: { sourceCompany?: bigint; document?: boolean; extraTopics?: number } = {}
    ) {
        const id = randomUUID(),
            topicId = randomUUID(),
            sourceId = randomUUID(),
            actionId = randomUUID();
        const stamp = new Date("2026-10-09T14:00:00Z");
        await connection.db.insert(evidence).values({
            id: sourceId,
            companyId: options.sourceCompany ?? ours,
            createdByUserId: userId,
            kind: options.document ? "document" : "note",
            title: "Historical source",
            body: "Historical source content",
            observedAt: "2026-10-09",
            visibility: "private",
            createdAt: stamp,
            updatedAt: null,
        });
        await connection.db.insert(agendas).values({
            id,
            companyId: ours,
            createdByUserId: userId,
            weekStart: "2026-10-05",
            status: "held",
            summary: "PRIVATE derived prior AI summary",
            generatedAt: stamp,
            createdAt: stamp,
            updatedAt: null,
        });
        const topic = {
            companyId: ours,
            agendaId: id,
            origin: "ai" as const,
            status: "kept" as const,
            title: "PRIVATE derived prior issue",
            whyItMatters: "PRIVATE interpretation",
            proposedNextStep: "PRIVATE historical proposal",
            proposedDue: "2026-10-10",
            facts: [
                {
                    text: "Historical assertion",
                    refs: [{ ref: `ev:${sourceId}`, label: "Prior source", date: "2026-10-09" }],
                },
            ],
            createdAt: stamp,
            updatedAt: null,
        };
        await connection.db.insert(agendaTopics).values({ ...topic, id: topicId, position: 0 });
        for (let n = 0; n < (options.extraTopics ?? 0); n++)
            await connection.db
                .insert(agendaTopics)
                .values({ ...topic, id: `${topicId}-${n}`, position: n + 1 });
        await connection.db.insert(actions).values({
            id: actionId,
            companyId: ours,
            createdByUserId: userId,
            agendaId: id,
            topicId,
            title: "Original recorded action",
            owner: "Founder",
            dueOn: "2026-10-10",
            test: "Record the original result",
            status: "open",
            outcome: null,
            createdAt: stamp,
            updatedAt: null,
        });
        await connection.db.insert(states).values({
            agendaId: id,
            companyId: ours,
            version: 2,
            payload: { topicVersions: { [topicId]: 2 }, enhancements: [], submissions: {} },
        });
        return { id, topicId, sourceId, actionId };
    }

    it("loads exact prior-week history and preserves the old report and action across new generation", async () => {
        const prior = await previousReport();
        const oldReport = await getAgendaV1(ours, { id: prior.id });
        const oldActions = await listCommitmentsV1({ companyId: ours });
        const s = await generationSnapshot(ours, period, "rules", { actorId: userId });
        expect(s.input.previousVantageContext).toMatchObject({
            reportId: prior.id,
            weekStart: "2026-10-05",
            reportVersion: 2,
            topics: [
                {
                    topicId: prior.topicId,
                    recordedDecision: null,
                    reportedActions: [{ id: prior.actionId, status: "open" }],
                },
            ],
        });
        const current = await saveGeneration(ours, userId, s, result(s));
        expect(current.id).not.toBe(prior.id);
        expect(await getAgendaV1(ours, { id: prior.id })).toEqual(oldReport);
        expect(await listCommitmentsV1({ companyId: ours })).toEqual(oldActions);
        const regenerated = await generationSnapshot(ours, period, "rules", { actorId: userId });
        expect(regenerated.input.previousVantageContext!.reportId).toBe(prior.id);
        expect(regenerated.input.previousVantageContext!.reportId).not.toBe(current.id);
        await saveGeneration(ours, userId, regenerated, result(regenerated));
        expect(await getAgendaV1(ours, { id: prior.id })).toEqual(oldReport);
        expect(await listCommitmentsV1({ companyId: ours })).toEqual(oldActions);
    });

    it("binds history to the requesting actor without breaking legacy snapshot readers", async () => {
        await previousReport();
        expect((await snapshot()).input.previousVantageContext).toBeNull();
        const s = await generationSnapshot(ours, period, "rules", { actorId: userId });
        await expect(saveGeneration(ours, "different-actor", s, result(s))).rejects.toMatchObject({
            code: "generation_failed",
        });
        expect(await getAgendaV1(ours, { weekStart: period.weekStart })).toBeNull();
    });

    it.each(["foreign", "document", "deleted"] as const)(
        "masks prior derived content for %s sources",
        async kind => {
            const prior = await previousReport({
                sourceCompany: kind === "foreign" ? other : ours,
                document: kind === "document",
            });
            if (kind === "deleted")
                await connection.db
                    .delete(evidence)
                    .where(and(eq(evidence.companyId, ours), eq(evidence.id, prior.sourceId)));
            const s = await generationSnapshot(ours, period, "rules", { actorId: userId });
            expect(s.input.previousVantageContext!.topics).toEqual([]);
            expect(s.input.previousVantageContext!.summary).toBeNull();
            expect(s.input.previousVantageContext!.unavailableSources).toHaveLength(1);
            expect(JSON.stringify(s.input.previousVantageContext)).not.toContain("PRIVATE");
            expect(await getAgendaV1(ours, { id: prior.id })).not.toBeNull();
        }
    );

    it.each(["evidence", "observation"] as const)(
        "withholds future-dated prior %s references even when created before cutoff",
        async kind => {
            const prior = await previousReport();
            if (kind === "evidence") {
                await connection.db
                    .update(evidence)
                    .set({ observedAt: "2026-10-17", updatedAt: null })
                    .where(and(eq(evidence.companyId, ours), eq(evidence.id, prior.sourceId)));
            } else {
                const metricId = randomUUID(),
                    observationId = randomUUID(),
                    stamp = new Date("2026-10-09T14:00Z");
                await connection.db.insert(definitions).values({
                    id: metricId,
                    companyId: ours,
                    key: "historical-" + ours,
                    name: "Historical metric",
                    definition: "Synthetic count",
                    unit: "count",
                    createdAt: stamp,
                    updatedAt: null,
                });
                await connection.db.insert(observations).values({
                    id: observationId,
                    companyId: ours,
                    metricId,
                    createdByUserId: userId,
                    value: 10,
                    periodStart: "2026-10-12",
                    periodEnd: "2026-10-17",
                    createdAt: stamp,
                });
                await connection.db
                    .update(agendaTopics)
                    .set({
                        facts: [
                            {
                                text: "Historical claim",
                                refs: [
                                    {
                                        ref: `obs:${observationId}`,
                                        label: "Prior metric",
                                        date: "2026-10-17",
                                    },
                                ],
                            },
                        ],
                        updatedAt: null,
                    })
                    .where(
                        and(eq(agendaTopics.companyId, ours), eq(agendaTopics.id, prior.topicId))
                    );
            }
            const s = await generationSnapshot(ours, period, "rules", { actorId: userId });
            expect(s.input.previousVantageContext!.topics).toEqual([]);
            expect(s.input.previousVantageContext!.summary).toBeNull();
            expect(s.input.previousVantageContext!.unavailableSources[0]!.status).toBe(
                "after-cutoff"
            );
        }
    );

    it.each(["decision", "source", "omitted-topic", "report-delete", "source-delete"] as const)(
        "rejects persistence after prior %s changes during generation",
        async kind => {
            const prior = await previousReport({ extraTopics: 7 });
            const s = await generationSnapshot(ours, period, "rules", { actorId: userId });
            if (kind === "decision")
                await decideV1({
                    companyId: ours,
                    userId,
                    topicId: prior.topicId,
                    key: "past-decision",
                    decision: "Changed human choice",
                    commitment: null,
                });
            if (kind === "source")
                await connection.db
                    .update(evidence)
                    .set({ body: "Changed full source body", updatedAt: null })
                    .where(and(eq(evidence.companyId, ours), eq(evidence.id, prior.sourceId)));
            if (kind === "omitted-topic")
                await connection.db
                    .update(agendaTopics)
                    .set({ whyItMatters: "Changed beyond bounded history", updatedAt: null })
                    .where(
                        and(
                            eq(agendaTopics.companyId, ours),
                            eq(agendaTopics.id, `${prior.topicId}-6`)
                        )
                    );
            if (kind === "report-delete")
                await connection.db
                    .delete(agendas)
                    .where(and(eq(agendas.companyId, ours), eq(agendas.id, prior.id)));
            if (kind === "source-delete")
                await connection.db
                    .delete(evidence)
                    .where(and(eq(evidence.companyId, ours), eq(evidence.id, prior.sourceId)));
            await expect(saveGeneration(ours, userId, s, result(s))).rejects.toMatchObject({
                code: "stale_context",
            });
            expect(await getAgendaV1(ours, { weekStart: period.weekStart })).toBeNull();
        }
    );

    it("rejects a pending generation if a previously missing prior report appears", async () => {
        const s = await generationSnapshot(ours, period, "rules", { actorId: userId });
        expect(s.input.previousVantageContext).toBeNull();
        await previousReport();
        await expect(saveGeneration(ours, userId, s, result(s))).rejects.toMatchObject({
            code: "stale_context",
        });
    });

    it("has applied both migration sets and the SQL/schema primary-action invariant", async () => {
        const [engine] =
            await connection.client`SELECT count(*)::int AS count FROM _launchstack_migrations WHERE state='applied'`;
        const [product] =
            await connection.client`SELECT count(*)::int AS count FROM _launchstack_web_migrations WHERE state='applied'`;
        expect(engine!.count).toBe(4);
        expect(product!.count).toBe(28);
        const indexes =
            await connection.client`SELECT indexdef FROM pg_indexes WHERE indexname='vantage_commitments_primary_topic_unique'`;
        expect(indexes).toHaveLength(1);
        expect(indexes[0]!.indexdef).toContain("WHERE (topic_id IS NOT NULL)");
        expect(
            getTableConfig(actions).indexes.some(
                i => i.config.name === "vantage_commitments_primary_topic_unique"
            )
        ).toBe(true);
    });
    it("loads only authorized date/cutoff evidence and comparable observations", async () => {
        const stamp = new Date("2026-10-16T17:00Z");
        for (const [id, observedAt, createdAt, companyId] of [
            ["start", "2026-10-12", stamp, ours],
            ["today", "2026-10-16", stamp, ours],
            ["old", "2026-10-11", stamp, ours],
            ["future-date", "2026-10-17", stamp, ours],
            ["future-created", "2026-10-16", new Date("2026-10-16T18:00:00.001Z"), ours],
            ["foreign", "2026-10-16", stamp, other],
        ] as const)
            await connection.db.insert(evidence).values({
                id: `${ours}-${id}`,
                companyId,
                createdByUserId: userId,
                kind: "note",
                title: id,
                body: "Synthetic",
                observedAt,
                createdAt,
            });
        const metricId = randomUUID();
        await connection.db.insert(definitions).values({
            id: metricId,
            companyId: ours,
            key: "signups",
            name: "Signups",
            definition: "Unique registrations",
            createdAt: stamp,
        });
        for (const [id, periodStart, periodEnd] of [
            ["current", "2026-10-12", "2026-10-16"],
            ["comparison", "2026-10-05", "2026-10-09"],
            ["full-prior", "2026-10-05", "2026-10-11"],
            ["straddling", "2026-10-11", "2026-10-12"],
            ["future", "2026-10-12", "2026-10-17"],
        ] as const)
            await connection.db.insert(observations).values({
                id: `${ours}-${id}`,
                companyId: ours,
                metricId,
                createdByUserId: userId,
                value: 5,
                periodStart,
                periodEnd,
                createdAt: stamp,
            });
        const { input } = await snapshot();
        expect(input.data.currentEvidence.map(e => e.title).sort()).toEqual(["start", "today"]);
        expect(input.data.currentObservations.map(o => o.id)).toEqual([`${ours}-current`]);
        expect(input.data.comparisonObservations.map(o => o.id)).toEqual([`${ours}-comparison`]);
        expect(input.inputVersion).toBe(
            fingerprint({
                period: input.reportPeriod,
                data: input.data,
                reviewedTopics: input.reviewedTopics,
                previousVantageContext: null,
                previousVantageStateFingerprint: previousVantageFingerprint({
                    actorId: null,
                    weekStart: "2026-10-05",
                    missing: true,
                }),
                actorId: null,
            })
        );
    });
    it("enforces half-open resolved-action times and preserves carry-forward IDs/dates", async () => {
        const base = {
            companyId: ours,
            createdByUserId: userId,
            ...action,
            createdAt: new Date("2026-10-05T12:00Z"),
        };
        await connection.db.insert(actions).values([
            { ...base, id: `${ours}-carry`, dueOn: "2026-10-09" },
            {
                ...base,
                id: `${ours}-start`,
                status: "done",
                outcome: "Recorded",
                resolvedAt: new Date(period.startInclusive),
            },
            {
                ...base,
                id: `${ours}-end`,
                status: "done",
                outcome: "Recorded",
                resolvedAt: new Date(period.endExclusive),
            },
        ]);
        const { input } = await snapshot();
        expect(input.data.resolvedCommitments.map(c => c.id)).toEqual([`${ours}-start`]);
        expect(input.data.carryForwardCommitments).toMatchObject([
            { id: `${ours}-carry`, dueOn: "2026-10-09" },
        ]);
    });
    it("saves and reloads the report, topic IDs and contract metadata", async () => {
        const saved = await generated();
        expect(await getAgendaV1(ours, { id: saved.id })).toEqual(saved);
        expect(saved).toMatchObject({
            version: 1,
            reportPeriod: period,
            execution: { mode: "rules" },
        });
        expect(saved.topics[0]!.contentVersion).toBe(1);
    });
    it("rejects a foreign metric before inserting any observation", async () => {
        const metricId = randomUUID();
        await connection.db.insert(definitions).values({
            id: metricId,
            companyId: other,
            key: "foreign",
            name: "Foreign",
            definition: "Private metric",
        });
        await expect(
            createObservationsV1({
                companyId: ours,
                userId,
                inputs: [
                    { metricId, value: 10, periodStart: "2026-10-12", periodEnd: "2026-10-16" },
                ],
            })
        ).rejects.toMatchObject({ status: 404, code: "not_found" });
        expect(
            await connection.db.select().from(observations).where(eq(observations.companyId, ours))
        ).toHaveLength(0);
    });
    it.each(["matching", "missing", "mismatched"] as const)(
        "preserves a legacy generated topic with a %s action agenda link",
        async link => {
            const agenda = await generated(),
                topic = agenda.topics[0]!;
            await connection.db.insert(actions).values({
                id: randomUUID(),
                companyId: ours,
                createdByUserId: userId,
                agendaId: link === "missing" ? null : agenda.id,
                topicId: topic.id,
                ...action,
            });
            if (link === "mismatched") {
                const foreignAgendaId = randomUUID();
                await connection.db.insert(agendas).values({
                    id: foreignAgendaId,
                    companyId: other,
                    createdByUserId: userId,
                    weekStart: period.weekStart,
                });
                await connection.db
                    .update(actions)
                    .set({ agendaId: foreignAgendaId })
                    .where(eq(actions.topicId, topic.id));
            }
            const s = await snapshot();
            expect(s.input.reviewedTopics.map(t => t.topic.id)).toContain(topic.id);
            const saved = await saveGeneration(ours, userId, s, result(s, "New suggestion"));
            expect(saved.topics.find(t => t.id === topic.id)?.commitmentId).toBeTruthy();
            expect((await listCommitmentsV1({ companyId: ours }))[0]!.topicId).toBe(topic.id);
        }
    );
    it("allows only one of two concurrent first-generation snapshots to save", async () => {
        const [a, b] = await Promise.all([snapshot(), snapshot()]);
        const settled = await Promise.allSettled([
            saveGeneration(ours, userId, a, result(a)),
            saveGeneration(ours, userId, b, result(b)),
        ]);
        expect(settled.filter(r => r.status === "fulfilled")).toHaveLength(1);
        expect(settled.find(r => r.status === "rejected")).toMatchObject({
            reason: { code: "stale_agenda" },
        });
        expect(
            await connection.db.select().from(agendas).where(eq(agendas.companyId, ours))
        ).toHaveLength(1);
    });
    it("concurrent same-key decisions create one action and stable decision timestamps", async () => {
        const agenda = await generated(),
            id = agenda.topics[0]!.id;
        const responses = await Promise.all(Array.from({ length: 8 }, () => decision(id)));
        expect(new Set(responses.map(r => r.commitmentId)).size).toBe(1);
        expect(new Set(responses.map(r => r.decidedAt)).size).toBe(1);
        expect(await listCommitmentsV1({ companyId: ours })).toHaveLength(1);
    });
    it("conflicting payloads and a second primary action fail without changing saved work", async () => {
        const agenda = await generated(),
            id = agenda.topics[0]!.id;
        const first = await decision(id),
            saved = await getAgendaV1(ours, { id: agenda.id });
        await expect(
            decideV1({
                companyId: ours,
                userId,
                topicId: id,
                key: "submission-one",
                decision: "Different",
                commitment: action,
            })
        ).rejects.toMatchObject({ code: "idempotency_conflict" });
        await expect(
            decideV1({
                companyId: ours,
                userId,
                topicId: id,
                key: "new-key",
                decision: "Different",
                commitment: { ...action, title: "Another action" },
            })
        ).rejects.toMatchObject({ code: "commitment_exists" });
        await expect(
            createCommitmentV1({ companyId: ours, userId, input: { ...action, topicId: id } })
        ).rejects.toMatchObject({ code: "commitment_exists" });
        expect(await getAgendaV1(ours, { id: agenda.id })).toEqual(saved);
        expect((await listCommitmentsV1({ companyId: ours }))[0]!.id).toBe(first.commitmentId);
    });
    it("requires an outcome, then decision retry preserves resolved state and timestamps", async () => {
        const agenda = await generated(),
            topic = await decision(agenda.topics[0]!.id);
        await expect(
            updateCommitmentV1({
                companyId: ours,
                id: topic.commitmentId!,
                patch: { status: "done" },
            })
        ).rejects.toMatchObject({ status: 400 });
        const done = await updateCommitmentV1({
            companyId: ours,
            id: topic.commitmentId!,
            patch: { status: "done", outcome: "Five interviews recorded" },
        });
        await decision(topic.id);
        expect((await listCommitmentsV1({ companyId: ours }))[0]).toMatchObject({
            id: done.id,
            status: "done",
            outcome: done.outcome,
            resolvedAt: done.resolvedAt,
        });
        const again = await updateCommitmentV1({
            companyId: ours,
            id: done.id,
            patch: { status: "done" },
        });
        expect(again.resolvedAt).toBe(done.resolvedAt);
    });
    it("rejects cross-company records/links and mismatched topic/agenda ownership", async () => {
        const agenda = await generated(),
            id = agenda.topics[0]!.id;
        expect(await getAgendaV1(other, { id: agenda.id })).toBeNull();
        await expect(
            patchTopicV1(other, id, { title: "Stolen", expectedContentVersion: 1 })
        ).rejects.toMatchObject({
            status: 404,
        });
        await expect(
            createCommitmentV1({ companyId: other, userId, input: { ...action, topicId: id } })
        ).rejects.toMatchObject({ status: 404 });
        await expect(
            createCommitmentV1({
                companyId: other,
                userId,
                input: { ...action, agendaId: agenda.id },
            })
        ).rejects.toMatchObject({ status: 404 });
        const otherSnapshot = await generationSnapshot(
            ours,
            reportPeriod(new Date("2026-10-16T18:00Z"), "2026-10-05"),
            "rules"
        );
        const another = await saveGeneration(ours, userId, otherSnapshot, result(otherSnapshot));
        await expect(
            createCommitmentV1({
                companyId: ours,
                userId,
                input: { ...action, topicId: id, agendaId: another.id },
            })
        ).rejects.toMatchObject({ status: 400 });
    });
    it("does not reveal a foreign topic title even for a legacy corrupt link", async () => {
        const agenda = await generated();
        await connection.db.insert(actions).values({
            id: randomUUID(),
            companyId: other,
            createdByUserId: userId,
            topicId: agenda.topics[0]!.id,
            ...action,
        });
        expect(await listCommitmentsV1({ companyId: other })).toMatchObject([{ topicTitle: null }]);
    });
    it("retains human edits and rejects a stale generation without partial changes", async () => {
        const agenda = await generated(),
            s = await snapshot();
        const edited = await patchTopicV1(ours, agenda.topics[0]!.id, {
            title: "Founder wording",
            proposedDue: "",
            expectedContentVersion: agenda.topics[0]!.contentVersion,
        });
        await expect(saveGeneration(ours, userId, s, result(s))).rejects.toMatchObject({
            code: "stale_agenda",
        });
        const fresh = await snapshot();
        expect(fresh.input.reviewedTopics[0]!.contentVersion).toBe(edited.contentVersion);
        const saved = await saveGeneration(
            ours,
            userId,
            fresh,
            result(fresh, "New generated suggestion")
        );
        expect(saved.topics).toHaveLength(2);
        expect(saved.topics.find(t => t.id === edited.id)).toMatchObject({
            title: "Founder wording",
            proposedDue: null,
        });
    });
    it("requires the topic content version and rejects stale compare-and-set edits", async () => {
        const agenda = await generated();
        const topic = agenda.topics[0]!;
        await expect(
            patchTopicV1(ours, topic.id, { title: "Missing version" })
        ).rejects.toMatchObject({ status: 400, code: "validation_error" });
        const first = await patchTopicV1(ours, topic.id, {
            title: "First human wording",
            expectedContentVersion: topic.contentVersion,
        });
        await expect(
            patchTopicV1(ours, topic.id, {
                title: "Lost update",
                expectedContentVersion: topic.contentVersion,
            })
        ).rejects.toMatchObject({ status: 409, code: "stale_topic" });
        expect((await getAgendaV1(ours, { id: agenda.id }))!.topics[0]!.title).toBe(first.title);
    });
    it("rejects a generation when an input source changes after snapshot", async () => {
        const agenda = await generated();
        const before = await getAgendaV1(ours, { id: agenda.id });
        const s = await snapshot();
        await connection.db.insert(evidence).values({
            id: `${ours}-source-edit`,
            companyId: ours,
            createdByUserId: userId,
            kind: "note",
            title: "Source edit",
            body: "Added while the model was running",
            observedAt: period.weekStart,
            createdAt: new Date("2026-10-16T17:00Z"),
        });
        await expect(
            saveGeneration(ours, userId, s, result(s, "Must not replace"))
        ).rejects.toMatchObject({
            status: 409,
            code: "stale_context",
        });
        expect(await getAgendaV1(ours, { id: agenda.id })).toEqual(before);
    });
    it("loads evidence, observations, and commitments by id with company scope", async () => {
        await connection.db.insert(evidence).values([
            {
                id: `${ours}-direct-evidence`,
                companyId: ours,
                createdByUserId: userId,
                kind: "note",
                title: "Direct evidence",
                body: "Read by id",
                observedAt: period.weekStart,
            },
            {
                id: `${other}-direct-evidence`,
                companyId: other,
                createdByUserId: userId,
                kind: "note",
                title: "Foreign evidence",
                body: "Must stay private",
                observedAt: period.weekStart,
            },
        ]);
        expect(await getEvidence({ companyId: ours, id: `${ours}-direct-evidence` })).toMatchObject(
            {
                id: `${ours}-direct-evidence`,
                title: "Direct evidence",
            }
        );
        expect(await getEvidence({ companyId: ours, id: `${other}-direct-evidence` })).toBeNull();

        const metricId = randomUUID();
        await connection.db.insert(definitions).values({
            id: metricId,
            companyId: ours,
            key: "direct_metric",
            name: "Direct metric",
            definition: "A metric read by id",
            unit: "percent",
        });
        const observationId = `${ours}-direct-observation`;
        await connection.db.insert(observations).values({
            id: observationId,
            companyId: ours,
            metricId,
            createdByUserId: userId,
            value: -2.5,
            periodStart: period.weekStart,
            periodEnd: period.weekStart,
        });
        expect(await getObservation({ companyId: ours, id: observationId })).toMatchObject({
            id: observationId,
            metricKey: "direct_metric",
            value: -2.5,
        });
        expect(await getObservation({ companyId: other, id: observationId })).toBeNull();

        const agenda = await generated();
        const topic = agenda.topics[0]!;
        const created = await decision(topic.id);
        expect(await getCommitment({ companyId: ours, id: created.commitmentId! })).toMatchObject({
            id: created.commitmentId,
            topicId: topic.id,
        });
        expect(await getCommitment({ companyId: other, id: created.commitmentId! })).toBeNull();
    });
    it("separate enhancement review is repeatable and never rewrites human content", async () => {
        const agenda = await generated(),
            topic = await patchTopicV1(ours, agenda.topics[0]!.id, {
                title: "Human text",
                expectedContentVersion: agenda.topics[0]!.contentVersion,
            });
        const s = await snapshot(),
            r = result(s);
        r.draft.topics = [];
        r.enhancements = [
            {
                topicId: topic.id,
                baseTopicVersion: topic.contentVersion,
                kind: "idea",
                text: "A separate idea",
                refs: [],
                rationale: "Consider it",
            },
        ];
        const saved = await saveGeneration(ours, userId, s, r),
            enhancement = saved.enhancements[0]!;
        const accepted = await reviewEnhancement(
            ours,
            topic.id,
            enhancement.id,
            "accepted",
            topic.contentVersion
        );
        expect(
            await reviewEnhancement(
                ours,
                topic.id,
                enhancement.id,
                "accepted",
                topic.contentVersion
            )
        ).toEqual(accepted);
        await expect(
            reviewEnhancement(ours, topic.id, enhancement.id, "dismissed", topic.contentVersion)
        ).rejects.toMatchObject({ code: "enhancement_finalized" });
        expect((await getAgendaV1(ours, { id: agenda.id }))!.topics[0]!.title).toBe("Human text");
    });
    it("rejects an enhancement after the original human topic changes", async () => {
        const agenda = await generated(),
            topic = await patchTopicV1(ours, agenda.topics[0]!.id, {
                title: "Human text",
                expectedContentVersion: agenda.topics[0]!.contentVersion,
            });
        const s = await snapshot(),
            r = result(s);
        r.draft.topics = [];
        r.enhancements = [
            {
                topicId: topic.id,
                baseTopicVersion: topic.contentVersion,
                kind: "idea",
                text: "A separate idea",
                refs: [],
                rationale: "Consider it",
            },
        ];
        const saved = await saveGeneration(ours, userId, s, r);
        await patchTopicV1(ours, topic.id, {
            title: "Newer human text",
            expectedContentVersion: topic.contentVersion,
        });
        await expect(
            reviewEnhancement(
                ours,
                topic.id,
                saved.enhancements[0]!.id,
                "accepted",
                topic.contentVersion
            )
        ).rejects.toMatchObject({ code: "stale_topic" });
    });
    it("all API-facing report mutations invalidate a pending generation snapshot", async () => {
        const agenda = await generated();
        const staleAfter = async (mutate: () => Promise<unknown>) => {
            const s = await snapshot();
            await mutate();
            await expect(saveGeneration(ours, userId, s, result(s))).rejects.toMatchObject({
                code: "stale_agenda",
            });
        };
        let founder!: Awaited<ReturnType<typeof addTopicV1>>;
        await staleAfter(async () => {
            founder = await addTopicV1({
                companyId: ours,
                agendaId: agenda.id,
                input: { title: "Founder-added" },
            });
        });
        await staleAfter(() =>
            reorderTopicsV1({ companyId: ours, agendaId: agenda.id, ids: [founder.id] })
        );
        await staleAfter(() =>
            setAgendaStatusV1({ companyId: ours, id: agenda.id, status: "held" })
        );
        await decision(founder.id);
        const [linked] = await listCommitmentsV1({ companyId: ours });
        await staleAfter(() =>
            updateCommitmentV1({
                companyId: ours,
                id: linked!.id,
                patch: { title: "Updated action" },
            })
        );
        await staleAfter(() => clearDecisionV1({ companyId: ours, topicId: founder.id }));
        await staleAfter(() => deleteCommitmentV1({ companyId: ours, id: linked!.id }));
        await staleAfter(() => deleteTopicV1({ companyId: ours, id: founder.id }));
    });
    it("database fault rolls back both decision/action and generation replacement", async () => {
        const agenda = await generated(),
            before = await getAgendaV1(ours, { id: agenda.id });
        const functionName = `tl_fail_${ours}`,
            triggerName = `tl_fail_${ours}`;
        await connection.client.unsafe(
            `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.company_id = ${ours} THEN RAISE EXCEPTION 'synthetic TL rollback fault'; END IF; RETURN NEW; END $$`
        );
        await connection.client.unsafe(
            `CREATE TRIGGER ${triggerName} BEFORE INSERT OR UPDATE ON pdr_ai_v2_vantage_contract_state FOR EACH ROW EXECUTE FUNCTION ${functionName}()`
        );
        try {
            await expect(decision(agenda.topics[0]!.id)).rejects.toThrow();
            expect(await listCommitmentsV1({ companyId: ours })).toHaveLength(0);
            expect(await getAgendaV1(ours, { id: agenda.id })).toEqual(before);
            const s = await snapshot();
            await expect(
                saveGeneration(ours, userId, s, result(s, "Must roll back"))
            ).rejects.toThrow();
            expect(await getAgendaV1(ours, { id: agenda.id })).toEqual(before);
        } finally {
            await connection.client.unsafe(
                `DROP TRIGGER ${triggerName} ON pdr_ai_v2_vantage_contract_state`
            );
            await connection.client.unsafe(`DROP FUNCTION ${functionName}()`);
        }
    });
    it("the database itself rejects duplicate primary links", async () => {
        const agenda = await generated(),
            topicId = agenda.topics[0]!.id;
        await decision(topicId);
        await expect(
            connection.db.insert(actions).values({
                id: randomUUID(),
                companyId: ours,
                createdByUserId: userId,
                agendaId: agenda.id,
                topicId,
                ...action,
            })
        ).rejects.toThrow();
        expect(await listCommitmentsV1({ companyId: ours })).toHaveLength(1);
        const stored = await connection.db
            .select()
            .from(states)
            .where(and(eq(states.companyId, ours), eq(states.agendaId, agenda.id)));
        expect(stored).toHaveLength(1);
        expect((await connection.db.execute(sql`SELECT 1 AS ok`))[0]).toMatchObject({ ok: 1 });
    });

    const rollingPeriod = (week = "2026-10-12") =>
        reportPeriod(new Date("2026-11-16T17:00:00Z"), week);
    async function pendingPrior() {
        const prior = await previousReport();
        await connection.db
            .update(agendaTopics)
            .set({
                decisionQuestion: "Should pilot access wait for the deletion dry-run result?",
                decision: "Keep the go/no-go question until the result is reviewed.",
                decidedAt: new Date("2026-10-09T15:00:00Z"),
                updatedAt: null,
            })
            .where(eq(agendaTopics.id, prior.topicId));
        return prior;
    }
    async function saveNoTopics(week = "2026-10-12") {
        const s = await generationSnapshot(ours, rollingPeriod(week), "rules", { actorId: userId });
        const r = result(s);
        r.draft.topics = [];
        r.signals = {
            ...r.signals,
            weekStart: s.input.reportPeriod.weekStart,
            since: s.input.reportPeriod.weekStart,
            computedAt: s.input.reportPeriod.asOf,
        };
        const agenda = await saveGeneration(ours, userId, s, r);
        return { s, agenda };
    }
    it("rolls the exact original question through a saved zero-topic second week into the third week", async () => {
        const prior = await pendingPrior();
        const old = await getAgendaV1(ours, { id: prior.id });
        const second = await saveNoTopics();
        expect(second.agenda.topics).toEqual([]);
        const third = await generationSnapshot(ours, rollingPeriod("2026-10-19"), "rules", {
            actorId: userId,
        });
        expect(third.input.pendingHistoricalQuestions!.questions).toMatchObject([
            {
                questionId: prior.topicId,
                originReportId: prior.id,
                originTopicId: prior.topicId,
                originWeekStart: "2026-10-05",
                question: "Should pilot access wait for the deletion dry-run result?",
            },
        ]);
        expect(third.pendingHistoricalState.questions).toHaveLength(1);
        expect(await getAgendaV1(ours, { id: prior.id })).toEqual(old);
    });
    it("persists and exposes more than one validation batch even when the model outputs no topics", async () => {
        const prior = await previousReport({ extraTopics: 104 });
        await connection.db
            .update(agendaTopics)
            .set({
                decisionQuestion: "What evidence will justify the requested go/no-go decision?",
                updatedAt: null,
            })
            .where(eq(agendaTopics.agendaId, prior.id));
        const second = await saveNoTopics();
        expect(second.s.pendingHistoricalState.questions).toHaveLength(105);
        expect(second.s.input.pendingHistoricalQuestions!.questions).toHaveLength(105);
        const view = await getPendingHistoricalQuestionsV1({
            companyId: ours,
            agendaId: second.agenda.id,
            actorId: userId,
        });
        expect(view.questions).toHaveLength(105);
        const last = view.questions.at(-1)!;
        const reviewed = await reviewPendingHistoricalQuestionV1({
            companyId: ours,
            userId,
            agendaId: second.agenda.id,
            questionId: last.questionId,
            expectedVersion: view.version,
            status: "dismissed",
        });
        expect(reviewed.questions).toHaveLength(104);
        expect(second.s.pendingHistoricalState.questions).toHaveLength(105);
    });
    it("rolls the latest saved predecessor across a skipped week and never seeds same-week topics as history", async () => {
        const prior = await pendingPrior();
        const second = await saveNoTopics();
        const skippedPeriod = rollingPeriod("2026-10-26");
        const skipped = await generationSnapshot(ours, skippedPeriod, "rules", { actorId: userId });
        // No report exists for October 19. Older AI prose stays out, but saved human lineage survives.
        expect(skipped.input.previousVantageContext).toBeNull();
        expect(skipped.input.pendingHistoricalQuestions!.questions).toMatchObject([
            { questionId: prior.topicId, originReportId: prior.id, originWeekStart: "2026-10-05" },
        ]);
        const current = await saveGeneration(ours, userId, skipped, result(skipped));
        await decideV1({
            companyId: ours,
            userId,
            topicId: current.topics[0]!.id,
            key: "same-week-not-history",
            decision: "A current-week decision must not self-seed its own pending history.",
            commitment: null,
        });
        const regenerated = await generationSnapshot(ours, skippedPeriod, "rules", {
            actorId: userId,
        });
        expect(
            regenerated.input.pendingHistoricalQuestions!.questions.map(
                question => question.questionId
            )
        ).toEqual([prior.topicId]);
        expect(regenerated.input.previousVantageContext).toBeNull();
        expect(regenerated.input.reviewedTopics.map(topic => topic.topic.id)).toContain(
            current.topics[0]!.id
        );
        expect(await getAgendaV1(ours, { id: second.agenda.id })).toEqual(second.agenda);
    });
    it.each(["dismissed", "addressed"] as const)(
        "human %s persists across same-week and next-week generation without changing the original report or action",
        async status => {
            const prior = await pendingPrior();
            const old = await getAgendaV1(ours, { id: prior.id });
            const oldActions = await listCommitmentsV1({ companyId: ours });
            const second = await saveNoTopics();
            const view = await getPendingHistoricalQuestionsV1({
                companyId: ours,
                agendaId: second.agenda.id,
                actorId: userId,
            });
            const dismissed = await reviewPendingHistoricalQuestionV1({
                companyId: ours,
                userId,
                agendaId: second.agenda.id,
                questionId: prior.topicId,
                expectedVersion: view.version,
                status,
                reason: "Synthetic human review",
            });
            expect(dismissed.questions).toEqual([]);
            await saveNoTopics();
            const third = await generationSnapshot(ours, rollingPeriod("2026-10-19"), "rules", {
                actorId: userId,
            });
            expect(third.input.pendingHistoricalQuestions!.questions).toEqual([]);
            expect(third.pendingHistoricalState.reviews[prior.topicId]!.status).toBe(status);
            expect(await getAgendaV1(ours, { id: prior.id })).toEqual(old);
            expect(await listCommitmentsV1({ companyId: ours })).toEqual(oldActions);
        }
    );
    it("checks review CAS, actor/company scope, and exact original identity", async () => {
        const prior = await pendingPrior();
        const second = await saveNoTopics();
        const base = {
            companyId: ours,
            userId,
            agendaId: second.agenda.id,
            questionId: prior.topicId,
            expectedVersion: second.agenda.version,
            status: "dismissed" as const,
        };
        await expect(
            getPendingHistoricalQuestionsV1({
                companyId: other,
                agendaId: second.agenda.id,
                actorId: userId,
            })
        ).rejects.toMatchObject({ code: "not_found" });
        await expect(
            getPendingHistoricalQuestionsV1({
                companyId: ours,
                agendaId: second.agenda.id,
                actorId: "",
            })
        ).rejects.toMatchObject({ status: 403 });
        await expect(
            reviewPendingHistoricalQuestionV1({ ...base, questionId: randomUUID() })
        ).rejects.toMatchObject({ code: "not_found" });
        await reviewPendingHistoricalQuestionV1(base);
        await expect(reviewPendingHistoricalQuestionV1(base)).rejects.toMatchObject({
            code: "stale_agenda",
        });
    });
    it("does not infer closure from an expired due date or a done commitment", async () => {
        const prior = await pendingPrior();
        await updateCommitmentV1({
            companyId: ours,
            id: prior.actionId,
            patch: {
                status: "done",
                outcome: "An action result was reported; the decision still needs review.",
            },
        });
        const second = await saveNoTopics();
        expect(second.s.input.pendingHistoricalQuestions!.questions).toHaveLength(1);
        expect(second.s.input.pendingHistoricalQuestions!.questions[0]!.suggestedDue).toBe(
            "2026-10-10"
        );
        expect(second.s.pendingHistoricalState.reviews).toEqual({});
    });
    it.each(["deleted-source", "document", "foreign-origin", "future-origin", "future-source"])(
        "withholds %s question content while retaining the full persisted lineage",
        async change => {
            const prior = await pendingPrior();
            const second = await saveNoTopics();
            if (change === "deleted-source")
                await connection.db.delete(evidence).where(eq(evidence.id, prior.sourceId));
            if (change === "document")
                await connection.db
                    .update(evidence)
                    .set({ kind: "document" })
                    .where(eq(evidence.id, prior.sourceId));
            if (change === "foreign-origin")
                await connection.db
                    .update(agendaTopics)
                    .set({ companyId: other })
                    .where(eq(agendaTopics.id, prior.topicId));
            if (change === "future-origin")
                await connection.db
                    .update(agendaTopics)
                    .set({ updatedAt: new Date("2026-12-01T00:00:00Z") })
                    .where(eq(agendaTopics.id, prior.topicId));
            if (change === "future-source")
                await connection.db
                    .update(evidence)
                    .set({ observedAt: "2026-12-01" })
                    .where(eq(evidence.id, prior.sourceId));
            const third = await generationSnapshot(ours, rollingPeriod("2026-10-19"), "rules", {
                actorId: userId,
            });
            expect(third.pendingHistoricalState.questions).toHaveLength(1);
            expect(third.input.pendingHistoricalQuestions!.questions).toEqual([]);
            expect(third.input.pendingHistoricalQuestions!.unavailableCount).toBe(1);
            const view = await getPendingHistoricalQuestionsV1({
                companyId: ours,
                agendaId: second.agenda.id,
                actorId: userId,
            });
            expect(view.questions).toEqual([]);
            expect(view.unavailableCount).toBe(1);
            expect(JSON.stringify(view)).not.toContain(prior.topicId);
            expect(JSON.stringify(view)).not.toContain("PRIVATE");
        }
    );
    it("treats an explicit original-topic dismissal as a human tombstone without rewriting it", async () => {
        const prior = await pendingPrior();
        await saveNoTopics();
        await connection.db
            .update(agendaTopics)
            .set({ status: "dismissed" })
            .where(eq(agendaTopics.id, prior.topicId));
        const third = await generationSnapshot(ours, rollingPeriod("2026-10-19"), "rules", {
            actorId: userId,
        });
        expect(third.input.pendingHistoricalQuestions!.questions).toEqual([]);
        expect(third.input.pendingHistoricalQuestions!.unavailableCount).toBe(0);
        expect(third.pendingHistoricalState.reviews[prior.topicId]!.status).toBe("dismissed");
    });
    it("withholds lineage from a previous carrier report generated after the reporting cutoff", async () => {
        await pendingPrior();
        const second = await saveNoTopics();
        await connection.db
            .update(agendas)
            .set({ generatedAt: new Date("2026-12-01T00:00:00Z"), updatedAt: null })
            .where(eq(agendas.id, second.agenda.id));
        const third = await generationSnapshot(ours, rollingPeriod("2026-10-19"), "rules", {
            actorId: userId,
        });
        expect(third.pendingHistoricalState.questions).toHaveLength(1);
        expect(third.input.pendingHistoricalQuestions!.questions).toEqual([]);
        expect(third.input.pendingHistoricalQuestions!.unavailableCount).toBe(1);
        expect(JSON.stringify(third.input.pendingHistoricalQuestions)).not.toContain("PRIVATE");
    });
    it.each(["old-origin", "old-source", "carried-review"])(
        "rejects generation if %s changes after its rolling snapshot",
        async change => {
            const prior = await pendingPrior();
            const second = await saveNoTopics();
            const third = await generationSnapshot(ours, rollingPeriod("2026-10-19"), "rules", {
                actorId: userId,
            });
            if (change === "old-origin")
                await patchTopicV1(ours, prior.topicId, {
                    decisionQuestion: "Edited original question",
                    expectedContentVersion: 2,
                });
            if (change === "old-source")
                await connection.db
                    .update(evidence)
                    .set({ body: "Changed content far beyond any prompt projection" })
                    .where(eq(evidence.id, prior.sourceId));
            if (change === "carried-review")
                await reviewPendingHistoricalQuestionV1({
                    companyId: ours,
                    userId,
                    agendaId: second.agenda.id,
                    questionId: prior.topicId,
                    expectedVersion: second.agenda.version,
                    status: "addressed",
                });
            await expect(saveGeneration(ours, userId, third, result(third))).rejects.toMatchObject({
                code: "stale_context",
            });
        }
    );
});
