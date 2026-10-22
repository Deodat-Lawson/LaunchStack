/** @jest-environment node */
/**
 * Real PostgreSQL + actual route/repository handlers. Authentication/session and
 * generation are explicit test doubles; this is not a login, browser or AI test.
 * Opt in only to the disposable local TL database named below. No env fallback.
 */
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { configureDatabase, createDb, type Db } from "@launchstack/store/client";
import { company } from "@launchstack/store/schema";
import {
    vantageAgendas,
    vantageAgendaTopics,
    vantageCommitments,
    vantageEvidence,
    vantageMetricDefinitions,
    vantageMetricObservations,
    type GenerationPort,
} from "@launchstack/pipelines/vantage";
import type { WorkspaceContextResult } from "~/lib/require-workspace-context";
import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockContext = jest.fn<Promise<WorkspaceContextResult>, []>();
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: () => mockContext(),
}));
jest.mock("~/lib/models", () => ({
    resolveConfiguredChatModel: () => {
        throw new Error("Real model calls are outside this TL test.");
    },
}));

import { installVantageGenerationPort } from "~/server/vantage/generation-port";
import { POST as generateReport, GET as listReports } from "~/app/api/vantage/agendas/route";
import { GET as getReport } from "~/app/api/vantage/agendas/[id]/route";
import { POST as addTopic } from "~/app/api/vantage/agendas/[id]/topics/route";
import { PATCH as editTopic } from "~/app/api/vantage/topics/[id]/route";
import { POST as decide } from "~/app/api/vantage/topics/[id]/decide/route";
import { POST as createAction, GET as listActions } from "~/app/api/vantage/commitments/route";
import { PATCH as updateAction } from "~/app/api/vantage/commitments/[id]/route";
import { GET as getEvidenceById } from "~/app/api/vantage/evidence/[id]/route";
import { POST as addEvidence, GET as listEvidence } from "~/app/api/vantage/evidence/route";
import { POST as importMetrics } from "~/app/api/vantage/metrics/import/route";
import { POST as addObservation } from "~/app/api/vantage/metrics/observations/route";
import { GET as getObservationById } from "~/app/api/vantage/metrics/observations/[id]/route";

const url = process.env.VANTAGE_TL_TEST_DATABASE_URL;
if (url) {
    const target = new URL(url);
    if (
        !(
            ["localhost", "127.0.0.1"].includes(target.hostname) &&
            target.port === "55437" &&
            target.pathname === "/vantage_week2_tl_contract_v1" &&
            ["postgres:", "postgresql:"].includes(target.protocol)
        )
    ) {
        throw new Error(
            "TL route tests require the explicitly named disposable localhost database."
        );
    }
}
const databaseSuite = url ? describe : describe.skip;
const savedEnv = { ...process.env };
const action = {
    title: "Interview five users",
    owner: "Founder",
    dueOn: "2026-10-20",
    test: "Five synthetic interview notes",
};
function request(body: unknown, headers: Record<string, string> = {}) {
    return new NextRequest("http://localhost/api/vantage/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
    });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const fakeGeneration: GenerationPort = async input => ({
    runId: input.runId,
    inputVersion: input.inputVersion,
    draft: {
        summary: "Synthetic TL route verification report",
        origin: "rules",
        modelMetadata: { mode: "rules" },
        topics: [
            {
                title: "Synthetic generated topic",
                facts: [],
                whyItMatters: "Test persistence",
                decisionQuestion: "Proceed?",
                proposedNextStep: "Review",
                proposedOwner: null,
                proposedDue: null,
                helpRequested: null,
                unknowns: [],
                conflicts: [],
                rationale: "Test adapter",
            },
        ],
    },
    signals: {
        weekStart: input.reportPeriod.weekStart,
        since: input.reportPeriod.weekStart,
        computedAt: input.reportPeriod.asOf,
        metricChanges: [],
        metricConflicts: [],
        metricsWithoutData: [],
        newEvidence: [],
        recentEvidenceIds: input.data.currentEvidence.map(e => e.id),
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
        promptVersion: "tl-route-test-double",
        attempts: 0,
        durationMs: 0,
    },
});

databaseSuite("Contract v1 actual routes + isolated PostgreSQL (session/generator doubles)", () => {
    jest.setTimeout(30000);
    let database: Db;
    let A: bigint, B: bigint;
    let agendaId: string, topicId: string, foreignAgendaId: string, foreignTopicId: string;
    let createdCompanies: number[] = [];
    function signIn(
        companyId = A,
        authUserId = "tl-route-operator",
        permissions = ["documents.read", "documents.edit"] as const
    ) {
        mockContext.mockResolvedValue({
            success: true,
            data: makeWorkspaceContext({ companyId, authUserId, permissions }),
        });
    }
    beforeAll(async () => {
        database = createDb({ url: url!, maxConnections: 3 });
        configureDatabase(database.db);
        const [identity] = await database.client`SELECT current_database() AS name`;
        expect(identity!.name).toBe("vantage_week2_tl_contract_v1");
        installVantageGenerationPort(fakeGeneration);
    });
    beforeEach(async () => {
        const made = await database.db
            .insert(company)
            .values([
                { name: `TL route A ${randomUUID()}`, numberOfEmployees: "1-10" },
                { name: `TL route B ${randomUUID()}`, numberOfEmployees: "1-10" },
            ])
            .returning({ id: company.id });
        createdCompanies = made.map(c => c.id);
        [A, B] = createdCompanies.map(BigInt) as [bigint, bigint];
        process.env.DATABASE_URL = url;
        process.env.VANTAGE_TEST_DATABASE_URL = url;
        process.env.VANTAGE_TEST_MODE = "true";
        process.env.VANTAGE_TEST_COMPANY_ID = A.toString();
        process.env.VANTAGE_TEST_USER_IDS = "tl-route-operator";
        signIn();
        agendaId = randomUUID();
        topicId = randomUUID();
        foreignAgendaId = randomUUID();
        foreignTopicId = randomUUID();
        await database.db.insert(vantageAgendas).values([
            {
                id: agendaId,
                companyId: A,
                createdByUserId: "tl-route-operator",
                weekStart: "2026-09-28",
            },
            {
                id: foreignAgendaId,
                companyId: B,
                createdByUserId: "foreign",
                weekStart: "2026-09-28",
            },
        ]);
        await database.db.insert(vantageAgendaTopics).values([
            {
                id: topicId,
                agendaId,
                companyId: A,
                title: "Synthetic local topic",
                position: 0,
                origin: "founder",
                status: "kept",
            },
            {
                id: foreignTopicId,
                agendaId: foreignAgendaId,
                companyId: B,
                title: "Synthetic foreign topic",
                position: 0,
                origin: "founder",
                status: "kept",
            },
        ]);
    });
    afterEach(async () => {
        if (createdCompanies.length)
            await database.db.delete(company).where(inArray(company.id, createdCompanies));
        createdCompanies = [];
        process.env = { ...savedEnv };
    });
    afterAll(async () => {
        await database?.close();
    });

    it("denies unauthenticated/excluded/wrong-workspace/missing-permission writes with zero rows", async () => {
        const body = {
            kind: "note",
            title: "Synthetic",
            body: "Synthetic body",
            observedAt: "2026-10-01",
        };
        mockContext.mockResolvedValue({
            success: false,
            response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        });
        expect((await addEvidence(request(body))).status).toBe(401);
        signIn(A, "excluded");
        expect((await addEvidence(request(body))).status).toBe(403);
        signIn(B);
        expect((await addEvidence(request(body))).status).toBe(403);
        mockContext.mockResolvedValue({
            success: true,
            data: makeWorkspaceContext({
                companyId: A,
                authUserId: "tl-route-operator",
                permissions: ["documents.read"],
            }),
        });
        expect((await addEvidence(request(body))).status).toBe(403);
        expect(
            await database.db
                .select()
                .from(vantageEvidence)
                .where(inArray(vantageEvidence.companyId, [A, B]))
        ).toHaveLength(0);
    });
    it("ignores JSON identity, scopes evidence reads, and rejects foreign report/topic IDs", async () => {
        const response = await addEvidence(
            request({
                kind: "note",
                title: "Synthetic",
                body: "Synthetic body",
                observedAt: "2026-10-01",
                companyId: B.toString(),
                userId: "foreign",
            })
        );
        expect(response.status).toBe(201);
        const rows = await database.db
            .select()
            .from(vantageEvidence)
            .where(eq(vantageEvidence.companyId, A));
        expect(rows).toHaveLength(1);
        expect(rows[0]!.createdByUserId).toBe("tl-route-operator");
        const listed = await listEvidence(new NextRequest("http://localhost/api/vantage/evidence"));
        expect((await listed.json()).evidence).toHaveLength(1);
        const direct = await getEvidenceById(
            new NextRequest("http://localhost/api/vantage/evidence/direct"),
            params(rows[0]!.id)
        );
        expect(direct.status).toBe(200);
        expect((await direct.json()).evidence.id).toBe(rows[0]!.id);
        expect(
            (
                await getEvidenceById(
                    new NextRequest("http://localhost/api/vantage/evidence/missing"),
                    params("missing-evidence")
                )
            ).status
        ).toBe(404);
        expect(
            (
                await getReport(
                    new NextRequest("http://localhost/api/vantage/test"),
                    params(foreignAgendaId)
                )
            ).status
        ).toBe(404);
        expect(
            (
                await editTopic(
                    request({ title: "Wrong company", expectedContentVersion: 1 }),
                    params(foreignTopicId)
                )
            ).status
        ).toBe(404);
        const [foreign] = await database.db
            .select()
            .from(vantageAgendaTopics)
            .where(eq(vantageAgendaTopics.id, foreignTopicId));
        expect(foreign!.title).toBe("Synthetic foreign topic");
    });
    it("generates/saves/reads a v1 report through actual routes with an injected test generator", async () => {
        const response = await generateReport(
            request({ weekStart: "2026-09-21", generationMode: "rules" })
        );
        expect(response.status).toBe(201);
        const { agenda } = await response.json();
        expect(agenda).toMatchObject({
            weekStart: "2026-09-21",
            version: 1,
            execution: { mode: "rules", promptVersion: "tl-route-test-double" },
        });
        expect(agenda.reportPeriod.timeZone).toBe("America/New_York");
        const read = await getReport(
            new NextRequest("http://localhost/api/vantage/test"),
            params(agenda.id)
        );
        expect((await read.json()).agenda).toEqual(agenda);
        const list = await listReports(
            new NextRequest("http://localhost/api/vantage/agendas?week=2026-09-21")
        );
        expect((await list.json()).agenda.id).toBe(agenda.id);
    });
    it("imports valid CSV rows while reporting impossible dates without aborting the import", async () => {
        const csv = [
            "metric,value,period_start,period_end,source,note",
            "Synthetic CSV users,12,2026-10-01,2026-10-02,synthetic,test row",
            "Synthetic CSV users,99,2026-02-30,2026-03-01,synthetic,invalid date",
        ].join("\n");
        const response = await importMetrics(request({ csv }));
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.imported).toBe(1);
        expect(body.problems).toHaveLength(1);
        expect(body.problems[0].line).toBe(3);
        expect(body.createdMetrics).toContain("Synthetic CSV users");
    });

    it("rejects foreign observation metrics with 404 and persists only authorized metric inputs", async () => {
        const [local, foreign] = await database.db
            .insert(vantageMetricDefinitions)
            .values([
                {
                    id: randomUUID(),
                    companyId: A,
                    key: "synthetic-local",
                    name: "Synthetic local metric",
                    definition: "Synthetic count",
                    unit: "count",
                },
                {
                    id: randomUUID(),
                    companyId: B,
                    key: "synthetic-foreign",
                    name: "Synthetic foreign metric",
                    definition: "Synthetic count",
                    unit: "count",
                },
            ])
            .returning();
        const body = {
            value: 11,
            periodStart: "2026-10-01",
            periodEnd: "2026-10-02",
            source: "Synthetic",
        };
        const rejected = await addObservation(request({ ...body, metricId: foreign!.id }));
        expect(rejected.status).toBe(404);
        expect((await rejected.json()).code).toBe("not_found");
        const accepted = await addObservation(
            request({ ...body, metricId: local!.id, companyId: B.toString(), userId: "forged" })
        );
        expect(accepted.status).toBe(201);
        expect((await accepted.json()).observations).toHaveLength(1);
        const rows = await database.db
            .select()
            .from(vantageMetricObservations)
            .where(inArray(vantageMetricObservations.companyId, [A, B]));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            companyId: A,
            metricId: local!.id,
            createdByUserId: "tl-route-operator",
            value: 11,
        });
        const direct = await getObservationById(
            new NextRequest("http://localhost/api/vantage/metrics/observations/direct"),
            params(rows[0]!.id)
        );
        expect(direct.status).toBe(200);
        expect((await direct.json()).observation).toMatchObject({
            id: rows[0]!.id,
            metricKey: "synthetic-local",
            value: 11,
        });
        expect(
            (
                await getObservationById(
                    new NextRequest("http://localhost/api/vantage/metrics/observations/missing"),
                    params("missing-observation")
                )
            ).status
        ).toBe(404);
    });

    it("adds and edits human topics with stable IDs and advancing versions", async () => {
        const response = await addTopic(
            request({ title: "New synthetic human topic" }),
            params(agendaId)
        );
        expect(response.status).toBe(201);
        const original = (await response.json()).topic;
        expect(original.contentVersion).toBe(1);
        const edited = await editTopic(
            request({ title: "Edited synthetic human topic", expectedContentVersion: 1 }),
            params(original.id)
        );
        expect(edited.status).toBe(200);
        expect((await edited.json()).topic).toMatchObject({
            id: original.id,
            contentVersion: 2,
            title: "Edited synthetic human topic",
        });
        const saved = await getReport(
            new NextRequest("http://localhost/api/vantage/test"),
            params(agendaId)
        );
        expect((await saved.json()).agenda.version).toBe(2);
    });
    it("persists decisions atomically, retries stable IDs, and preserves resolved outcomes", async () => {
        const body = { decision: "Proceed with synthetic interviews", commitment: action };
        const submit = () =>
            decide(request(body, { "Idempotency-Key": "route-decision-1" }), params(topicId));
        const first = await submit();
        expect(first.status).toBe(200);
        const firstTopic = (await first.json()).topic;
        const resolved = await updateAction(
            request({ status: "done", outcome: "Five synthetic notes completed" }),
            params(firstTopic.commitmentId)
        );
        expect(resolved.status).toBe(200);
        const resolution = (await resolved.json()).commitment;
        const repeated = await submit();
        expect(repeated.status).toBe(200);
        expect((await repeated.json()).topic).toMatchObject({
            id: firstTopic.id,
            commitmentId: firstTopic.commitmentId,
            decidedAt: firstTopic.decidedAt,
        });
        const listed = await listActions(
            new NextRequest("http://localhost/api/vantage/commitments")
        );
        expect((await listed.json()).commitments).toHaveLength(1);
        const [saved] = await database.db
            .select()
            .from(vantageCommitments)
            .where(eq(vantageCommitments.id, firstTopic.commitmentId));
        expect(saved).toMatchObject({ status: "done", outcome: "Five synthetic notes completed" });
        expect(saved!.resolvedAt!.toISOString()).toBe(resolution.resolvedAt);
        const conflict = await decide(
            request(
                { ...body, decision: "Changed payload" },
                { "Idempotency-Key": "route-decision-1" }
            ),
            params(topicId)
        );
        expect(conflict.status).toBe(409);
        expect((await conflict.json()).code).toBe("idempotency_conflict");
    });
    it("rejects cross-company linked actions, duplicate primary actions and resolution without outcome", async () => {
        const foreign = await createAction(
            request({ ...action, agendaId: foreignAgendaId, topicId: foreignTopicId })
        );
        expect(foreign.status).toBe(404);
        const first = await createAction(request({ ...action, agendaId, topicId }));
        expect(first.status).toBe(201);
        const id = (await first.json()).commitment.id;
        const duplicate = await createAction(request({ ...action, agendaId, topicId }));
        expect(duplicate.status).toBe(409);
        expect((await duplicate.json()).code).toBe("commitment_exists");
        expect((await updateAction(request({ status: "done" }), params(id))).status).toBe(400);
        const [saved] = await database.db
            .select()
            .from(vantageCommitments)
            .where(eq(vantageCommitments.id, id));
        expect(saved!.status).toBe("open");
        expect(saved!.resolvedAt).toBeNull();
    });
});
