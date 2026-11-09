/** @jest-environment node */
/** Real synthetic PostgreSQL/authz/retrieval/persistence; session and model transports are doubles. */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { configureDatabase, createDb, type Db, type DbClient } from "@launchstack/store/client";
import { configureSecretBox, decryptSecret } from "@launchstack/store/crypto";
import { company, documentVersions } from "@launchstack/store/schema";
import {
    generationSnapshot,
    generateWeeklyAgendaV1,
    getAgendaV1,
    saveGeneration,
    vantageAgendas,
    vantageEvidence,
    type GenerationRuntime,
} from "@launchstack/pipelines/vantage";
import { contextSourceKeyV0 } from "@launchstack/pipelines/vantage/context-v0";
import { coerceMessageLikeToMessage, HumanMessage } from "@langchain/core/messages";
import type { ResolvedChatModel } from "@launchstack/llm";
import { documentGrants } from "~/server/db/schema";
let mockRealDb: DbClient;
const mockSession = jest.fn<Promise<{ user: { id: string } } | null>, []>();
jest.mock("~/server/db", () => ({
    get db() {
        return mockRealDb;
    },
}));
jest.mock("~/server/engine", () => ({ getEngine: () => ({ db: mockRealDb }) }));
jest.mock("~/server/auth", () => ({ getServerSession: () => mockSession() }));
jest.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
jest.mock("~/lib/models", () => ({ resolveConfiguredChatModel: jest.fn() }));
import { seedSophiaCompositionFixtureV0 } from "~/server/vantage/experiments/sophia-fixture-v0";
import {
    createVantageContextDemoService,
    DEMO_METADATA_KEY,
    type VantageDemoDescriptor,
} from "~/server/vantage/demo-service";
import { createSophiaContextGenerationExperimentV0 } from "../../../../pipelines/src/vantage/experiments/sophia-generation-v0";

const target = process.env.VANTAGE_TL_TEST_DATABASE_URL;
if (target) {
    const url = new URL(target);
    if (
        url.hostname !== "127.0.0.1" ||
        url.port !== "55437" ||
        url.pathname !== "/vantage_week2_tl_contract_v1"
    )
        throw new Error("Only the existing dedicated synthetic TL database is permitted.");
}
const suite = target ? describe : describe.skip;
const originalEnv = { ...process.env };
const model = {
    modelId: "gpt-6-luna",
    reasoning: {
        mode: "effort",
        enabled: true,
        effort: "none",
        requestPatch: { reasoning_effort: "none" },
    },
    behavior: { parameters: { systemMessages: "supported" } },
    prepareMessages: (messages: Parameters<ResolvedChatModel["prepareMessages"]>[0]) =>
        messages.map(coerceMessageLikeToMessage),
} as unknown as ResolvedChatModel;
const runtime: GenerationRuntime = {
    resolveModel: () => null,
    signal: new AbortController().signal,
    budgets: { attemptTimeoutMs: 20000, maxAttempts: 2, retryWaitMs: 1000, totalMs: 45000 },
};

suite("local context demo real PostgreSQL service", () => {
    jest.setTimeout(60000);
    let connection: Db;
    let fixture: Awaited<ReturnType<typeof seedSophiaCompositionFixtureV0>>;
    let descriptor: VantageDemoDescriptor;
    let service: ReturnType<typeof createVantageContextDemoService>;
    let duringGeneration: (() => Promise<void>) | undefined;
    let errors: jest.SpyInstance;
    const invoke = jest.fn();
    const week = "2026-10-12";
    const topic = (ref: string) => ({
        title: "PRIVATE_CONTEXT_TOPIC_SENTINEL",
        facts: [{ text: "The supplied synthetic account needs a sample comparison.", refs: [ref] }],
        conflicts: [],
        whyItMatters:
            "The accounts require an identifier comparison before privacy approval is inferred.",
        decisionQuestion: "Which account identifiers should the reviewers compare first?",
        proposedNextStep:
            "Compare QA and operations account identifiers for run-17; record overlaps and unmatched accounts.",
        proposedOwner: null,
        proposedDueInDays: null,
        helpRequested: null,
        unknowns: ["Whether both sources describe the same sample."],
        rationale: "A comparison can clarify the supplied accounts.",
    });
    const regenerateNative = async () => {
        const snapshot = await generationSnapshot(
            BigInt(fixture.companyId),
            fixture.nativeGenerationInput.reportPeriod,
            "rules",
            { actorId: fixture.actorId }
        );
        return saveGeneration(
            BigInt(fixture.companyId),
            fixture.actorId,
            snapshot,
            await generateWeeklyAgendaV1(snapshot.input, runtime)
        );
    };
    beforeAll(async () => {
        connection = createDb({ url: target!, maxConnections: 12 });
        mockRealDb = connection.db;
        configureDatabase(mockRealDb);
        configureSecretBox({ key: randomBytes(32).toString("base64") });
    });
    beforeEach(async () => {
        errors = jest.spyOn(console, "error").mockImplementation(() => {});
        fixture = await seedSophiaCompositionFixtureV0(mockRealDb);
        mockSession.mockResolvedValue({ user: { id: fixture.actorId } });
        Object.assign(process.env, {
            NODE_ENV: "development",
            DATABASE_URL: target,
            VANTAGE_TL_TEST_MODE: "true",
            VANTAGE_TL_TEST_DATABASE_URL: target,
            VANTAGE_TEST_DATABASE_URL: target,
            VANTAGE_TEST_MODE: "true",
            VANTAGE_TEST_COMPANY_ID: fixture.companyId,
            VANTAGE_TEST_USER_IDS: fixture.actorId,
            VANTAGE_CONTEXT_DEMO_ENABLED: "true",
        });
        descriptor = {
            schemaVersion: "vantage-context-demo/v1",
            fixtureId: fixture.fixtureId,
            companyId: fixture.companyId,
            actorId: fixture.actorId,
            documentIds: [...fixture.request.documentIds],
            starDocumentIds: [...fixture.request.starDocumentIds],
            roleContext: fixture.request.roleContext,
            roleProfileVersions: { ...fixture.request.roleProfileVersions },
            weeks: [{ weekStart: week, asOf: fixture.request.reportWindow.asOf }],
        };
        await regenerateNative();
        duringGeneration = undefined;
        invoke.mockReset();
        const generator = createSophiaContextGenerationExperimentV0(async <T>() => ({
            result: (await invoke()) as T,
            usage: { inputTokens: 100, outputTokens: 100, totalTokens: 200 },
        }));
        service = createVantageContextDemoService({
            database: mockRealDb,
            loadDescriptor: async () => descriptor,
            resolveModel: () => model,
            generate: async (envelope, runtime) => {
                await duringGeneration?.();
                const doc = envelope.evidenceSnapshot.entries.find(
                    entry =>
                        entry.source.id === `workspace-document/${fixture.docs.independentOps.id}`
                )!;
                invoke.mockResolvedValue({
                    native: {
                        summary: "Synthetic native carrier remains separate.",
                        topics: [topic(`ev:${envelope.v1Input.data.currentEvidence[0]!.id}`)],
                        enhancements: [],
                    },
                    experimental: {
                        summary: "PRIVATE_CONTEXT_SUMMARY_SENTINEL",
                        topics: [topic(contextSourceKeyV0(doc.source))],
                        enhancements: [],
                    },
                });
                return generator(envelope, runtime);
            },
        });
    });
    afterEach(async () => {
        await fixture.cleanup();
        process.env = { ...originalEnv };
        errors.mockRestore();
    });
    afterAll(async () => {
        configureSecretBox({ key: undefined });
        await connection?.close();
    });
    const generate = () => service.generateWeek(week);
    const row = async () =>
        (
            await mockRealDb
                .select()
                .from(vantageAgendas)
                .where(eq(vantageAgendas.companyId, BigInt(fixture.companyId)))
        )[0]!;

    it.each(["disabled", "production", "wrong-database"])(
        "fails closed before context work for %s",
        async condition => {
            if (condition === "disabled") process.env.VANTAGE_CONTEXT_DEMO_ENABLED = "false";
            else if (condition === "production")
                Object.assign(process.env, { NODE_ENV: "production" });
            else process.env.DATABASE_URL = "postgres://invalid@localhost:5433/pdr_ai_v2";
            await expect(service.load(week)).rejects.toBeDefined();
            expect(invoke).not.toHaveBeenCalled();
        }
    );
    it("requires real native workspace authorization and the matching synthetic actor/company descriptor", async () => {
        mockSession.mockResolvedValue(null);
        await expect(service.load(week)).rejects.toMatchObject({ status: 401 });
        mockSession.mockResolvedValue({ user: { id: fixture.actorId } });
        descriptor.actorId = "another-synthetic-subject";
        await expect(service.load(week)).rejects.toMatchObject({ status: 403 });
        descriptor.actorId = fixture.actorId;
        const [owned] = await mockRealDb
            .select({ name: company.name })
            .from(company)
            .where(eq(company.id, Number(fixture.companyId)));
        await mockRealDb
            .update(company)
            .set({ name: "Non-demo synthetic negative fixture" })
            .where(eq(company.id, Number(fixture.companyId)));
        try {
            await expect(service.load(week)).rejects.toMatchObject({ status: 403 });
        } finally {
            await mockRealDb
                .update(company)
                .set({ name: owned!.name })
                .where(eq(company.id, Number(fixture.companyId)));
        }
    });
    it("allows actor-authorized Company Architecture inspection before any model generation", async () => {
        const state = await service.load(week);
        expect(state.report).toBeNull();
        expect(state.nativeAgendaId).toBeTruthy();
        expect(state.companyArchitecture?.reviewState).toBe("unreviewed");
        expect(state.companyArchitecture?.body).toContain("Synthetic");
        const exact = await service.source(
            state.nativeAgendaId!,
            state.companyArchitecture!.source
        );
        expect(exact.contentHash).toBe(state.companyArchitecture!.contentHash);
        expect(invoke).not.toHaveBeenCalled();
        await expect(
            service.source(state.nativeAgendaId!, { ...exact.source, version: "wrong" })
        ).rejects.toMatchObject({ status: 404 });
    });
    it("preflights real prompt construction without provider calls or persistence and reports the exact byte cap", async () => {
        expect(await service.preflight(week)).toMatchObject({
            ready: true,
            providerCalled: false,
            persisted: false,
        });
        const oversized = createVantageContextDemoService({
            database: mockRealDb,
            loadDescriptor: async () => descriptor,
            resolveModel: () => ({
                ...model,
                prepareMessages: messages => [
                    ...model.prepareMessages(messages),
                    new HumanMessage("x".repeat(30000)),
                ],
            }),
        });
        const result = await oversized.preflight(week);
        expect(result).toMatchObject({
            ready: false,
            providerCalled: false,
            persisted: false,
            reason: "paired-prompt-budget",
            promptByteLimit: 23500,
        });
        expect("promptBytes" in result && Number(result.promptBytes)).toBeGreaterThan(23500);
        expect(invoke).not.toHaveBeenCalled();
        expect((await row()).modelMetadata?.[DEMO_METADATA_KEY]).toBeUndefined();
    });
    it("stores encrypted context only and leaves the native report/topics unchanged", async () => {
        const native = await getAgendaV1(BigInt(fixture.companyId), { weekStart: week });
        const state = await generate();
        expect(state.report?.summary).toBe("PRIVATE_CONTEXT_SUMMARY_SENTINEL");
        expect(state.report?.diagnostics.context).toMatchObject({
            roleIds: ["engineering", "founder"],
            personalStarCount: 1,
            researchMode: "STOP",
            missingCount: 0,
            optionalUnavailableCount: 2,
        });
        expect(state.report?.diagnostics.context?.selectedCount).toBe(
            state.report?.diagnostics.sources.length
        );
        expect(JSON.stringify(state.report?.diagnostics.context)).not.toContain(
            `workspace-document/${fixture.docs.hidden.id}`
        );
        expect(JSON.stringify(state.report?.diagnostics.context)).not.toContain(
            `workspace-document/${fixture.docs.foreign.id}`
        );
        const after = await getAgendaV1(BigInt(fixture.companyId), { weekStart: week });
        expect(after?.summary).toBe(native?.summary);
        expect(after?.topics).toEqual(native?.topics);
        expect(after?.version).toBe(native?.version);
        expect(JSON.stringify(after?.modelMetadata)).not.toMatch(
            /PRIVATE_CONTEXT|Compare QA|account identifiers/
        );
        expect((await row()).modelMetadata?.[DEMO_METADATA_KEY]).toMatchObject({
            schemaVersion: "encrypted-vantage-context-demo/v1",
            version: 1,
        });
        const selected = state.report!.diagnostics.sources.find(
            entry => entry.source.id === `workspace-document/${fixture.docs.independentOps.id}`
        )!;
        const source = await service.source(state.report!.id, selected.source);
        expect(source.body).toContain("2 of 3");
        expect(source.source.version).toBe(fixture.docs.independentOps.versionId);
    });
    it("persists human review CAS and retains its exact encrypted namespace across native regeneration", async () => {
        const initial = await generate(),
            report = initial.report!;
        const reviewed = await service.review({
            reportId: report.id,
            topicId: report.topics[0]!.id,
            expectedVersion: report.version,
            status: "kept",
            decision: {
                value: "needs-more-evidence",
                text: "Compare the account identifiers first.",
            },
        });
        expect(reviewed.report?.topics[0]).toMatchObject({
            status: "kept",
            decision: {
                value: "needs-more-evidence",
                text: "Compare the account identifiers first.",
            },
        });
        await expect(
            service.review({
                reportId: report.id,
                topicId: report.topics[0]!.id,
                expectedVersion: report.version,
                status: "dismissed",
            })
        ).rejects.toMatchObject({ code: "stale_context_review" });
        const before = (await row()).modelMetadata?.[DEMO_METADATA_KEY];
        await regenerateNative();
        expect((await row()).modelMetadata?.[DEMO_METADATA_KEY]).toEqual(before);
        const reloaded = await service.load(week);
        expect(reloaded.report?.topics[0]).toEqual(reviewed.report?.topics[0]);
        expect(reloaded.report?.version).toBe(2);
    });
    it("archives reviewed context on explicit regeneration without converting reviews to actions", async () => {
        const initial = await generate(),
            report = initial.report!;
        await service.review({
            reportId: report.id,
            topicId: report.topics[0]!.id,
            expectedVersion: report.version,
            status: "dismissed",
        });
        const next = await generate();
        expect(next.report?.diagnostics.historicalHumanDecisions).toBe(1);
        const envelope = (await row()).modelMetadata?.[DEMO_METADATA_KEY] as { ciphertext: string };
        const payload = JSON.parse(decryptSecret(envelope.ciphertext)) as {
            history: { report: { topics: { id: string; status: string }[] } }[];
        };
        expect(payload.history[0]?.report.topics[0]).toMatchObject({
            id: report.topics[0]!.id,
            status: "dismissed",
        });
        expect(
            (await getAgendaV1(BigInt(fixture.companyId), { weekStart: week }))?.topics.every(
                topic => topic.commitmentId === null
            )
        ).toBe(true);
    });
    it("withholds obsolete report prose, citations and reviews after native evidence changes", async () => {
        const initial = await generate(),
            report = initial.report!;
        await mockRealDb
            .update(vantageEvidence)
            .set({ body: "New synthetic information." })
            .where(
                eq(vantageEvidence.id, fixture.nativeGenerationInput.data.currentEvidence[0]!.id)
            );
        const state = await service.load(week);
        expect(state.report).toBeNull();
        expect(state.unavailableReason).toBeTruthy();
        expect(JSON.stringify(state)).not.toContain("PRIVATE_CONTEXT_SUMMARY_SENTINEL");
        await expect(
            service.source(report.id, report.topics[0]!.facts[0]!.refs[0]!)
        ).rejects.toMatchObject({ code: "demo_native_input_changed" });
        await expect(
            service.review({
                reportId: report.id,
                topicId: report.topics[0]!.id,
                expectedVersion: report.version,
                status: "kept",
            })
        ).rejects.toMatchObject({ code: "demo_native_input_changed" });
    });
    it("withholds a saved report and source after its required document permission is revoked", async () => {
        const initial = await generate(),
            report = initial.report!;
        await mockRealDb
            .delete(documentGrants)
            .where(eq(documentGrants.documentId, BigInt(fixture.docs.privacyStar.id)));
        expect((await service.load(week)).report).toBeNull();
        await expect(
            service.source(report.id, report.topics[0]!.facts[0]!.refs[0]!)
        ).rejects.toBeDefined();
        expect(JSON.stringify((await row()).modelMetadata)).not.toContain(
            "PRIVATE_CONTEXT_SUMMARY_SENTINEL"
        );
    });
    it("rejects an unselected/foreign source or exact version mismatch", async () => {
        const state = await generate(),
            report = state.report!,
            ref = report.topics[0]!.facts[0]!.refs[0]!;
        await expect(
            service.source(report.id, { ...ref, version: "wrong-version" })
        ).rejects.toMatchObject({ status: 404 });
        await expect(
            service.source(report.id, {
                kind: "doc",
                id: `workspace-document/${fixture.docs.foreign.id}`,
                version: fixture.docs.foreign.versionId,
            })
        ).rejects.toMatchObject({ status: 404 });
    });
    it("rejects generation-time native document drift without persisting a sidecar", async () => {
        duringGeneration = async () => {
            await mockRealDb
                .update(documentVersions)
                .set({
                    ocrMetadata: {
                        text: "Changed during the synthetic generation interval.",
                        vantageSynthetic: {},
                    },
                })
                .where(eq(documentVersions.id, Number(fixture.docs.independentOps.versionId)));
        };
        await expect(generate()).rejects.toMatchObject({ code: "stale_optional_sources" });
        expect((await row()).modelMetadata?.[DEMO_METADATA_KEY]).toBeUndefined();
    });
    it("logs only safe failure identity and stage, never the provider exception message", async () => {
        duringGeneration = async () => {
            throw new Error("synthetic-sensitive-error-marker");
        };
        await expect(generate()).rejects.toThrow("synthetic-sensitive-error-marker");
        expect(errors).toHaveBeenCalledWith(
            "[vantage-demo] Generation failed",
            expect.objectContaining({
                stage: "model-generation",
                errorName: "Error",
                errorClass: "Error",
            })
        );
        expect(JSON.stringify(errors.mock.calls)).not.toContain("synthetic-sensitive-error-marker");
        expect((await row()).modelMetadata?.[DEMO_METADATA_KEY]).toBeUndefined();
    });
});
