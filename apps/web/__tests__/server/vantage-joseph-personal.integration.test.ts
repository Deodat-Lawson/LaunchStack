/** @jest-environment node */
/** Real isolated PostgreSQL/ACL/profile/Sophia host; session identity is a double and choices are server-memory only. */
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { configureDatabase, createDb, type Db, type DbClient } from "@launchstack/store/client";
import { configureSecretBox } from "@launchstack/store/crypto";
import { document, documentVersions } from "@launchstack/store/schema";
import {
    generationSnapshot,
    generateWeeklyAgendaV1,
    getAgendaV1,
    saveGeneration,
    type GenerationRuntime,
} from "@launchstack/pipelines/vantage";
import {
    documentGrants,
    documentSettings,
    userCompanyMemberships,
    users,
} from "~/server/db/schema";
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
    type VantageDemoDescriptor,
} from "~/server/vantage/demo-service";

const target = process.env.VANTAGE_TL_TEST_DATABASE_URL;
if (target) {
    const value = new URL(target);
    if (
        value.hostname !== "127.0.0.1" ||
        !["55437", "55438"].includes(value.port) ||
        value.pathname !== "/vantage_week2_tl_contract_v1" ||
        value.username !== "vantage_week2_tl"
    )
        throw Error("Only explicitly isolated synthetic Vantage PostgreSQL targets are allowed.");
}
const suite = target ? describe : describe.skip,
    originalEnv = { ...process.env };
const runtime: GenerationRuntime = {
    resolveModel: () => null,
    signal: new AbortController().signal,
    budgets: { attemptTimeoutMs: 20000, maxAttempts: 2, retryWaitMs: 1000, totalMs: 45000 },
};
suite("Joseph authenticated demo host with real PostgreSQL", () => {
    jest.setTimeout(60000);
    let connection: Db,
        fixture: Awaited<ReturnType<typeof seedSophiaCompositionFixtureV0>>,
        descriptor: VantageDemoDescriptor,
        service: ReturnType<typeof createVantageContextDemoService>;
    let other: typeof fixture | undefined;
    let errors: jest.SpyInstance;
    const week = "2026-10-12",
        resolveModel = jest.fn(() => {
            throw Error("Unexpected model call in an incomplete required-context fixture.");
        });
    beforeAll(() => {
        connection = createDb({ url: target!, maxConnections: 12 });
        mockRealDb = connection.db;
        configureDatabase(mockRealDb);
        configureSecretBox({ key: randomBytes(32).toString("base64") });
    });
    beforeEach(async () => {
        errors = jest.spyOn(console, "error").mockImplementation(() => {});
        fixture = await seedSophiaCompositionFixtureV0(mockRealDb);
        other = undefined;
        resolveModel.mockClear();
        mockSession.mockResolvedValue({ user: { id: fixture.actorId } });
        Object.assign(process.env, {
            NODE_ENV: "development",
            DATABASE_URL: target,
            VANTAGE_TL_TEST_DATABASE_URL: target,
            VANTAGE_TL_TEST_MODE: "true",
            VANTAGE_CONTEXT_DEMO_DB_PORT: new URL(target!).port,
            VANTAGE_TEST_DATABASE_URL: target,
            VANTAGE_TEST_MODE: "true",
            VANTAGE_TEST_COMPANY_ID: fixture.companyId,
            VANTAGE_TEST_USER_IDS: fixture.actorId,
            VANTAGE_CONTEXT_DEMO_ENABLED: "true",
            VANTAGE_CONTEXT_DEMO_JOSEPH_ENABLED: "true",
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
        const snapshot = await generationSnapshot(
            BigInt(fixture.companyId),
            fixture.nativeGenerationInput.reportPeriod,
            "rules",
            { actorId: fixture.actorId }
        );
        await saveGeneration(
            BigInt(fixture.companyId),
            fixture.actorId,
            snapshot,
            await generateWeeklyAgendaV1(snapshot.input, runtime)
        );
        service = createVantageContextDemoService({
            database: mockRealDb,
            loadDescriptor: async () => descriptor,
            resolveModel,
        });
    });
    afterEach(async () => {
        await other?.cleanup();
        await fixture.cleanup();
        process.env = { ...originalEnv };
        errors.mockRestore();
    });
    afterAll(async () => {
        await connection.close();
    });
    it("projects actual authorized company/source versions and truthfully blocks unreviewed required context", async () => {
        const view = await service.personalContext(week);
        expect(view.persistence).toBe("server-process-memory");
        expect(view.ready).toBe(false);
        expect(view.blocker).toMatch(/unreviewed/i);
        expect(view.roles.roleIds).toEqual(["founder", "engineering"]);
        expect(view.roles.userConfirmed).toBe(false);
        expect(view.documents).toContainEqual(
            expect.objectContaining({
                id: `workspace-document/${fixture.docs.olderBlocker.id}`,
                version: fixture.docs.olderBlocker.versionId,
            })
        );
        expect(JSON.stringify(view)).not.toContain("SECRET_UNAUTHORIZED_SOPHIA");
        expect(JSON.stringify(view)).not.toContain("SECRET_FOREIGN_SOPHIA");
        expect(view.diagnostics.sources.find(source => source.lane === "company")?.status).toBe(
            "omitted"
        );
        expect(resolveModel).not.toHaveBeenCalled();
    });
    it("confirms roles/primary with process-memory CAS and retains the real native report", async () => {
        const before = await getAgendaV1(BigInt(fixture.companyId), { weekStart: week });
        const view = await service.updatePersonal(week, {
            operation: "roles",
            roleIds: ["founder", "engineering"],
            primaryRoleId: "engineering",
            expectedRevision: 0,
        });
        expect(view.state.revision).toBe(1);
        expect(view.roles.primaryRoleId).toBe("engineering");
        expect(view.roles.roleIds).toEqual(["engineering", "founder"]);
        expect(view.roles.userConfirmed).toBe(true);
        expect((await service.personalContext(week)).state).toEqual(view.state);
        await expect(
            service.updatePersonal(week, {
                operation: "roles",
                roleIds: ["founder"],
                expectedRevision: 0,
            })
        ).rejects.toMatchObject({ status: 409 });
        await expect(
            service.updatePersonal(week, {
                operation: "roles",
                roleIds: ["made-up-role"],
                expectedRevision: 1,
            })
        ).rejects.toMatchObject({ status: 400 });
        expect(await getAgendaV1(BigInt(fixture.companyId), { weekStart: week })).toEqual(before);
    });
    it("tracks a real old document's current exact version rather than stale star-time content", async () => {
        const selected = fixture.docs.olderBlocker,
            documentId = `workspace-document/${selected.id}`;
        const starred = await service.updatePersonal(week, {
            operation: "star",
            documentId,
            starred: true,
            expectedRevision: 0,
        });
        expect(starred.state.stars[0]?.lastKnownRef.version).toBe(selected.versionId);
        const [prior] = await mockRealDb
            .select()
            .from(documentVersions)
            .where(eq(documentVersions.id, Number(selected.versionId)));
        const stamp = new Date("2026-10-18T16:00:00Z");
        const [next] = await mockRealDb
            .insert(documentVersions)
            .values({
                documentId: BigInt(selected.id),
                versionNumber: 2,
                url: `local://synthetic-joseph/${fixture.fixtureId}/v2`,
                mimeType: "text/plain",
                ocrProcessed: true,
                ocrMetadata: {
                    ...(prior!.ocrMetadata as Record<string, unknown>),
                    text:
                        selected.text +
                        " Synthetic version two adds a sample-list reference; this does not prove completion.",
                },
                createdAt: stamp,
            })
            .returning({ id: documentVersions.id });
        await mockRealDb
            .update(document)
            .set({ currentVersionId: BigInt(next!.id), updatedAt: stamp })
            .where(eq(document.id, Number(selected.id)));
        const refreshed = await service.personalContext(week);
        expect(refreshed.documents.find(doc => doc.id === documentId)?.version).toBe(
            String(next!.id)
        );
        expect(refreshed.state.stars[0]?.lastKnownRef.version).toBe(selected.versionId);
        expect(
            refreshed.diagnostics.sources.find(source => source.lane === "star")?.source?.version
        ).toBe(String(next!.id));
        const restarred = await service.updatePersonal(week, {
            operation: "star",
            documentId,
            starred: true,
            expectedRevision: 1,
        });
        expect(restarred.state.stars).toHaveLength(1);
        expect(restarred.state.stars[0]?.lastKnownRef.version).toBe(String(next!.id));
    });
    it("hides a revoked source and permits removal of the actor's own pending star", async () => {
        const doc = fixture.docs.olderBlocker,
            documentId = `workspace-document/${doc.id}`,
            companyId = BigInt(fixture.companyId);
        await mockRealDb.insert(documentSettings).values({
            companyId,
            documentId: BigInt(doc.id),
            restricted: true,
            updatedBy: fixture.actorId,
        });
        await mockRealDb.insert(documentGrants).values({
            companyId,
            documentId: BigInt(doc.id),
            principalType: "user",
            principalId: fixture.actorPk,
            level: "view",
            grantedBy: fixture.actorId,
        });
        await service.updatePersonal(week, {
            operation: "star",
            documentId,
            starred: true,
            expectedRevision: 0,
        });
        await mockRealDb
            .delete(documentGrants)
            .where(
                and(
                    eq(documentGrants.companyId, companyId),
                    eq(documentGrants.documentId, BigInt(doc.id))
                )
            );
        const hidden = await service.personalContext(week);
        expect(hidden.documents.some(doc => doc.id === documentId)).toBe(false);
        expect(JSON.stringify(hidden)).not.toContain(doc.text);
        expect(hidden.diagnostics.sources.find(source => source.lane === "star")?.status).toBe(
            "missing"
        );
        await expect(
            service.updatePersonal(week, {
                operation: "star",
                documentId,
                starred: true,
                expectedRevision: 1,
            })
        ).rejects.toMatchObject({ status: 403 });
        expect(
            (
                await service.updatePersonal(week, {
                    operation: "star",
                    documentId,
                    starred: false,
                    expectedRevision: 1,
                })
            ).state.stars
        ).toEqual([]);
    });
    it("rejects cross-company/unauthorized sources without adding a star", async () => {
        for (const doc of [fixture.docs.foreign, fixture.docs.hidden])
            await expect(
                service.updatePersonal(week, {
                    operation: "star",
                    documentId: `workspace-document/${doc.id}`,
                    starred: true,
                    expectedRevision: 0,
                })
            ).rejects.toMatchObject({ status: 403 });
        expect((await service.personalContext(week)).state.stars).toEqual([]);
    });
    it("does not let a revoked original mock-required star prevent removal of a personal selection", async () => {
        const doc = fixture.docs.privacyStar,
            documentId = `workspace-document/${doc.id}`;
        await service.updatePersonal(week, {
            operation: "star",
            documentId,
            starred: true,
            expectedRevision: 0,
        });
        await mockRealDb
            .delete(documentGrants)
            .where(
                and(
                    eq(documentGrants.companyId, BigInt(fixture.companyId)),
                    eq(documentGrants.documentId, BigInt(doc.id))
                )
            );
        const view = await service.personalContext(week);
        expect(view.ready).toBe(false);
        expect(view.documents.some(candidate => candidate.id === documentId)).toBe(false);
        expect(view.diagnostics.sources.find(source => source.lane === "star")?.status).toBe(
            "missing"
        );
        expect(JSON.stringify(view)).not.toContain(doc.text);
        const removed = await service.updatePersonal(week, {
            operation: "star",
            documentId,
            starred: false,
            expectedRevision: 1,
        });
        expect(removed.state.stars).toEqual([]);
        expect(removed.ready).toBe(false);
    });
    it("rejects another authenticated actor or workspace rather than revealing the fixture", async () => {
        const secondId = `${fixture.actorId}-second`;
        const [second] = await mockRealDb
            .insert(users)
            .values({
                userId: secondId,
                name: "Synthetic second actor",
                email: `${secondId}@example.invalid`,
                companyId: BigInt(fixture.companyId),
            })
            .returning({ id: users.id });
        await mockRealDb.insert(userCompanyMemberships).values({
            userId: BigInt(second!.id),
            companyId: BigInt(fixture.companyId),
            role: "sophia-fixture-reader",
            status: "active",
        });
        process.env.VANTAGE_TEST_USER_IDS = `${fixture.actorId},${secondId}`;
        mockSession.mockResolvedValue({ user: { id: secondId } });
        await expect(service.personalContext(week)).rejects.toMatchObject({ status: 403 });
        other = await seedSophiaCompositionFixtureV0(mockRealDb);
        mockSession.mockResolvedValue({ user: { id: other.actorId } });
        process.env.VANTAGE_TEST_COMPANY_ID = other.companyId;
        process.env.VANTAGE_TEST_USER_IDS = other.actorId;
        await expect(service.personalContext(week)).rejects.toMatchObject({ status: 403 });
    });
    it("enforces disabled/production and missing-session gates before personal state", async () => {
        process.env.VANTAGE_CONTEXT_DEMO_JOSEPH_ENABLED = "false";
        await expect(service.personalContext(week)).rejects.toMatchObject({ status: 404 });
        process.env.VANTAGE_CONTEXT_DEMO_JOSEPH_ENABLED = "true";
        Object.assign(process.env, { NODE_ENV: "production" });
        await expect(service.personalContext(week)).rejects.toMatchObject({ status: 404 });
        Object.assign(process.env, { NODE_ENV: "development" });
        mockSession.mockResolvedValue(null);
        await expect(service.personalContext(week)).rejects.toMatchObject({ status: 401 });
    });
    it("blocks generation/preflight and preserves the saved report while review is unavailable", async () => {
        const before = await getAgendaV1(BigInt(fixture.companyId), { weekStart: week });
        await expect(service.generateWeek(week, "replay")).rejects.toMatchObject({
            status: 409,
            code: "joseph_required_context_incomplete",
        });
        await expect(service.preflight(week, "replay")).resolves.toMatchObject({
            ready: false,
            providerCalled: false,
            persisted: false,
            reason: "joseph-required-context-incomplete",
        });
        expect(await getAgendaV1(BigInt(fixture.companyId), { weekStart: week })).toEqual(before);
        expect(resolveModel).not.toHaveBeenCalled();
    });
});
