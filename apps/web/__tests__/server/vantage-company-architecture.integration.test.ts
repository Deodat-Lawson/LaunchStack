/** @jest-environment node */
/** Real isolated PostgreSQL profile/document/ACL reads; session and cookie identity are doubles. */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { configureDatabase, createDb, type Db, type DbClient } from "@launchstack/store/client";
import { category, company, document, documentVersions } from "@launchstack/store/schema";
import {
    companyMetadata,
    companyProfileSources,
    type CompanyMetadataJSON,
    type MetadataFact,
} from "@launchstack/tools/company-context/schema";
import {
    createEmptyMetadata,
    METADATA_SCHEMA_VERSION,
    READER_VERSION,
} from "@launchstack/pipelines/company-metadata";
import { vantageAgendas, vantageCommitments } from "@launchstack/pipelines/vantage";
import {
    assembleContextManifestV0,
    createSourceRegistryV0,
    type BusinessRoleContextV0,
    type RequiredContextBundleV0,
    type DynamicRetrievalInputV0,
    type DynamicRetrievalBundleV0,
} from "@launchstack/pipelines/vantage/context-v0";
import {
    documentGrants,
    documentSettings,
    folderSettings,
    userCompanyMemberships,
    users,
    workspaceRoles,
} from "~/server/db/schema";

let mockRealDb: DbClient;
const mockSession = jest.fn<Promise<{ user: { id: string } } | null>, []>();
jest.mock("~/server/db", () => ({
    get db() {
        return mockRealDb;
    },
}));
jest.mock("~/server/auth", () => ({ getServerSession: () => mockSession() }));
jest.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { createCompanyArchitectureAdapterV0 } from "~/server/vantage/company-architecture";

const url = process.env.VANTAGE_TL_TEST_DATABASE_URL;
if (url) {
    const target = new URL(url);
    if (
        target.hostname !== "127.0.0.1" ||
        target.port !== "55437" ||
        target.pathname !== "/vantage_week2_tl_contract_v1" ||
        !["postgres:", "postgresql:"].includes(target.protocol)
    )
        throw new Error(
            "Company architecture integration requires the dedicated local TL verification database."
        );
}
const databaseSuite = url ? describe : describe.skip;
const stamp = new Date("2026-10-16T16:00:00.000Z");
const reportWindow = {
    startInclusive: "2026-10-12T04:00:00.000Z",
    endExclusive: "2026-10-19T04:00:00.000Z",
    asOf: "2026-10-19T16:00:00.000Z",
};
const budgets = {
    maxSources: 20,
    maxExcerptChars: 8000,
    timeoutMs: 5000,
    maxQueries: 3,
    maxTokens: 8000,
};

databaseSuite("Company architecture actual profile/source/document ACL integration", () => {
    jest.setTimeout(30000);
    let connection: Db;
    let A: bigint, B: bigint, actorPk: bigint;
    let actorId: string, foreignActorId: string;
    let ownedCompanies: number[] = [];
    let metadata: CompanyMetadataJSON;
    let verifiedSyntheticDatabase = false;
    let service: ReturnType<typeof createCompanyArchitectureAdapterV0>;
    let docs: Record<"open" | "granted" | "hidden" | "foreign", { id: number; versionId: number }>;
    const adapter = () => service;
    const capture = () => adapter().capture({ reportWindow, budgets });
    const sourceFact = (
        value: string,
        doc: { id: number; versionId: number },
        priority: MetadataFact["priority"] = "normal"
    ): MetadataFact => ({
        value,
        visibility: "internal",
        usage: "no_outreach",
        confidence: 0.95,
        priority,
        status: "active",
        last_updated: stamp.toISOString(),
        sources: [
            {
                doc_id: doc.id,
                doc_name: `Synthetic document ${doc.id}`,
                version_id: doc.versionId,
                extracted_at: stamp.toISOString(),
                quote: value,
            },
        ],
    });
    async function saveMetadata(value: CompanyMetadataJSON) {
        await connection.db
            .update(companyMetadata)
            .set({ metadata: value, updatedAt: stamp })
            .where(eq(companyMetadata.companyId, A));
    }
    beforeAll(async () => {
        connection = createDb({ url: url!, maxConnections: 8 });
        mockRealDb = connection.db;
        configureDatabase(connection.db);
        const [identity] = await connection.client`SELECT current_database() AS name`;
        expect(identity!.name).toBe("vantage_week2_tl_contract_v1");
        verifiedSyntheticDatabase = identity!.name === "vantage_week2_tl_contract_v1";
    });
    beforeEach(async () => {
        jest.clearAllMocks();
        const companies = await connection.db
            .insert(company)
            .values([
                { name: `Architecture A ${randomUUID()}`, numberOfEmployees: "1" },
                { name: `Architecture B ${randomUUID()}`, numberOfEmployees: "1" },
            ])
            .returning({ id: company.id });
        ownedCompanies = companies.map(row => row.id);
        [A, B] = ownedCompanies.map(BigInt) as [bigint, bigint];
        actorId = `architecture-a-${randomUUID()}`;
        foreignActorId = `architecture-b-${randomUUID()}`;
        const actors = await connection.db
            .insert(users)
            .values([
                {
                    userId: actorId,
                    email: `${actorId}@example.invalid`,
                    name: "Synthetic actor A",
                    companyId: A,
                },
                {
                    userId: foreignActorId,
                    email: `${foreignActorId}@example.invalid`,
                    name: "Synthetic actor B",
                    companyId: B,
                },
            ])
            .returning({ id: users.id });
        actorPk = BigInt(actors[0]!.id);
        await connection.db.insert(userCompanyMemberships).values([
            { userId: actorPk, companyId: A, role: "architecture-reader", status: "active" },
            {
                userId: BigInt(actors[1]!.id),
                companyId: B,
                role: "architecture-reader",
                status: "active",
            },
        ]);
        await connection.db.insert(workspaceRoles).values(
            [A, B].map(companyId => ({
                companyId,
                slug: "architecture-reader",
                name: "Synthetic architecture reader",
                permissions: ["documents.read", "documents.edit"],
                createdBy: actorId,
            }))
        );
        const [board] = await connection.db
            .insert(category)
            .values({ companyId: A, name: "Board" })
            .returning({ id: category.id });
        await connection.db.insert(folderSettings).values({
            companyId: A,
            categoryId: BigInt(board!.id),
            visibility: "restricted",
            updatedBy: actorId,
        });
        docs = {} as typeof docs;
        for (const key of ["open", "granted", "hidden", "foreign"] as const) {
            const companyId = key === "foreign" ? B : A;
            const [row] = await connection.db
                .insert(document)
                .values({
                    companyId,
                    title:
                        key === "hidden" ? "SECRET_UNGRANTED_TITLE" : `Synthetic ${key} overview`,
                    category: key === "granted" || key === "hidden" ? "Board" : "General",
                    url: `local://architecture/${randomUUID()}`,
                    createdAt: stamp,
                    updatedAt: null,
                })
                .returning({ id: document.id });
            const [version] = await connection.db
                .insert(documentVersions)
                .values({
                    documentId: BigInt(row!.id),
                    versionNumber: 1,
                    url: `local://architecture-version/${randomUUID()}`,
                    mimeType: "text/plain",
                    ocrProcessed: true,
                    ocrMetadata: { text: `Synthetic ${key} document contents` },
                    createdAt: stamp,
                })
                .returning({ id: documentVersions.id });
            docs[key] = { id: row!.id, versionId: version!.id };
            await connection.db
                .update(document)
                .set({ currentVersionId: BigInt(version!.id), updatedAt: stamp })
                .where(eq(document.id, row!.id));
        }
        await connection.db.insert(documentSettings).values(
            [docs.granted, docs.hidden].map(doc => ({
                companyId: A,
                documentId: BigInt(doc.id),
                restricted: true,
                updatedBy: actorId,
            }))
        );
        await connection.db.insert(documentGrants).values({
            companyId: A,
            documentId: BigInt(docs.granted.id),
            principalType: "user",
            principalId: actorPk.toString(),
            level: "view",
            grantedBy: actorId,
        });
        metadata = createEmptyMetadata(A.toString(), stamp);
        metadata.company.name = sourceFact("Synthetic authorized company", docs.open);
        metadata.company.description = sourceFact(
            "Builds invoice verification software for pilot operators.",
            docs.open
        );
        metadata.profile = {
            facts: {
                mission: {
                    ...sourceFact(
                        "Make invoice verification testable before pilot access.",
                        docs.granted
                    ),
                    label: "Mission",
                },
            },
        };
        metadata.provenance.total_documents_processed = 2;
        metadata.provenance.sources_counted = 2;
        await connection.db.insert(companyMetadata).values({
            companyId: A,
            schemaVersion: METADATA_SCHEMA_VERSION,
            metadata,
            buildStatus: "idle",
            createdAt: stamp,
            updatedAt: stamp,
            builtAt: stamp,
        });
        for (const key of ["open", "granted"] as const)
            await connection.db.insert(companyProfileSources).values({
                companyId: A,
                documentId: BigInt(docs[key].id),
                versionId: BigInt(docs[key].versionId),
                role: "about_us",
                roleBy: "model",
                status: "done",
                facts:
                    key === "open" ? { company: metadata.company } : { profile: metadata.profile },
                factCount: key === "open" ? 2 : 1,
                passages: { total: 1, kept: 1, dropped: {} },
                readerVersion: READER_VERSION,
                modelId: "synthetic-profile-extractor",
                readAt: stamp,
                createdAt: stamp,
                updatedAt: null,
            });
        mockSession.mockResolvedValue({ user: { id: actorId } });
        service = createCompanyArchitectureAdapterV0({
            database: mockRealDb,
            now: () => new Date(reportWindow.asOf),
        });
    });
    afterEach(async () => {
        if (ownedCompanies.length)
            await connection.db.delete(company).where(inArray(company.id, ownedCompanies));
        ownedCompanies = [];
    });
    afterAll(async () => {
        await connection?.close();
    });

    it("projects native authorized company facts with exact source versions and remains unreviewed", async () => {
        const captured = await capture();
        expect(captured.actor.companyId).toBe(A.toString());
        expect(captured.projection.status).toBe("available");
        expect(captured.projection.requiredEntry!.source.reviewState).toBe("unreviewed");
        expect(JSON.stringify(captured.projection)).toContain("Make invoice verification testable");
        expect(captured.projection.includedFactPaths).toEqual(
            expect.arrayContaining(["company.name", "company.description", "profile.facts.mission"])
        );
        await expect(adapter().assertFresh(captured)).resolves.toBeDefined();
        const roleContext: BusinessRoleContextV0 = {
            contractVersion: "v0-proposed",
            authenticatedPrincipalRef: captured.actor.principalRef,
            roleIds: ["founder"],
            primaryRoleId: "founder",
            mappingVersion: "synthetic-role-map/v1",
            roles: [
                {
                    roleId: "founder",
                    description:
                        "Synthetic business-role test double, not a production role mapping.",
                    responsibilities: ["Review synthetic pilot readiness"],
                    priorities: ["Check supplied acceptance evidence"],
                },
            ],
            provenance: { kind: "server", source: "synthetic-business-role-test-double" },
            userConfirmed: false,
            fallback: false,
        };
        const requiredEntry = captured.projection.requiredEntry!;
        const record = captured.projection.record!;
        const required: RequiredContextBundleV0 = {
            contractVersion: "v0-proposed",
            asOf: reportWindow.asOf,
            actor: captured.actor,
            companyArchitecture: requiredEntry,
            workspaceMandatoryDocuments: [],
            personalVantageStars: [],
            constraints: [
                "Synthetic required-coverage fixture; mandatory-document and star discovery are not exercised.",
            ],
            coverage: {
                checked: [requiredEntry.source],
                used: [requiredEntry.source],
                missing: [],
                revoked: [],
                omitted: [],
            },
            status: "complete",
        };
        const retrievalInput: DynamicRetrievalInputV0 = {
            contractVersion: "v0-proposed",
            actor: captured.actor,
            verifiedRoleContext: roleContext,
            reportWindow,
            sourceCatalog: [record],
            budgets,
        };
        const retrieval: DynamicRetrievalBundleV0 = {
            contractVersion: "v0-proposed",
            actor: captured.actor,
            reportWindow,
            roleMatches: [],
            recentChanges: [],
            unresolvedOlderItems: [],
            sourceRegistry: [record],
            deduped: [],
            omissions: [],
            failures: [],
            status: "complete",
        };
        const registry = createSourceRegistryV0({
            actor: captured.actor,
            reportWindow,
            trustedCatalog: [record],
        });
        expect(registry.ok).toBe(true);
        if (!registry.ok)
            throw new Error("Authorized synthetic architecture registry was rejected.");
        const assembled = assembleContextManifestV0({
            runId: `architecture-pg-${randomUUID()}`,
            inputVersion: captured.snapshotFingerprint,
            actor: captured.actor,
            reportWindow,
            roleContext,
            roleProfileVersions: { founder: "synthetic-founder-profile/v1" },
            required,
            retrievalInput,
            retrieval,
            registry: registry.registry,
            budgets,
        });
        expect(assembled.ok).toBe(true);
        if (!assembled.ok) throw new Error(assembled.issues.map(issue => issue.code).join(","));
        expect(assembled.value.manifest.companyArchitectureVersion).toBe(
            requiredEntry.source.version
        );
        if (verifiedSyntheticDatabase && process.env.VANTAGE_TL_TEST_MODE === "true") {
            const sourceRoot = resolve(__dirname, "../../../..");
            const ignoredRoot = resolve(sourceRoot, "test-output");
            const destinationDirectory = resolve(
                ignoredRoot,
                "company-architecture-adapter",
                "20261025T180618Z"
            );
            if (!destinationDirectory.startsWith(ignoredRoot + sep))
                throw new Error("Synthetic artifact destination escaped test-output.");
            mkdirSync(destinationDirectory, { recursive: true });
            const filename = `actual-pg-profile-assembly-${new Date().toISOString().replace(/[^0-9TZ]/g, "")}-${randomUUID()}.json`;
            writeFileSync(
                resolve(destinationDirectory, filename),
                JSON.stringify(
                    {
                        evidence:
                            "Actual authorized synthetic PostgreSQL profile/source/document/ACL reads plus real V0 registry and assembler",
                        limitations: [
                            "Session identity and cookie are test doubles.",
                            "Business-role mapping, mandatory/star coverage and empty retrieval decisions are synthetic test doubles.",
                            "No AI call, public research, production route activation or complete production V0 pipeline is exercised.",
                        ],
                        database: "vantage_week2_tl_contract_v1",
                        actor: captured.actor,
                        projection: captured.projection,
                        snapshotFingerprint: captured.snapshotFingerprint,
                        assemblyInput: {
                            reportWindow,
                            budgets,
                            roleContext,
                            required,
                            retrievalInput,
                            retrieval,
                        },
                        assembled: assembled.value,
                    },
                    null,
                    2
                ) + "\n",
                { flag: "wx" }
            );
            console.info(`[synthetic-company-architecture] ${filename}`);
        }
    });
    it.each(["hidden", "foreign"] as const)(
        "withholds %s document-derived values even when marked manual_override",
        async key => {
            const value = key === "hidden" ? "SECRET_UNGRANTED_VALUE" : "FOREIGN_COMPANY_VALUE";
            const sensitiveFact = {
                ...sourceFact(value, docs[key], "manual_override"),
                label: "Sensitive synthetic fact",
            };
            metadata.profile!.facts!.sensitive = sensitiveFact;
            await saveMetadata(metadata);
            // Supply an otherwise fresh source cache too: denial must not depend on a missing extraction row.
            // The schema permits a mismatched company/document pair; the reader must enforce tenant scope.
            await connection.db.insert(companyProfileSources).values({
                companyId: A,
                documentId: BigInt(docs[key].id),
                versionId: BigInt(docs[key].versionId),
                role: "about_us",
                roleBy: "model",
                status: "done",
                facts: { profile: { facts: { sensitive: sensitiveFact } } },
                factCount: 1,
                passages: { total: 1, kept: 1, dropped: {} },
                readerVersion: READER_VERSION,
                modelId: "synthetic-profile-extractor",
                readAt: stamp,
                createdAt: stamp,
                updatedAt: null,
            });
            const captured = await capture();
            expect(captured.projection.status).toBe("partial");
            expect(captured.projection.requiredEntry).toBeUndefined();
            expect(JSON.stringify(captured.projection)).not.toContain(value);
            expect(JSON.stringify(captured.projection)).not.toContain("SECRET_UNGRANTED_TITLE");
        }
    );
    it("blocks a captured context after a document grant is revoked and never invokes persistence", async () => {
        const captured = await capture();
        await connection.db
            .delete(documentGrants)
            .where(
                and(
                    eq(documentGrants.companyId, A),
                    eq(documentGrants.documentId, BigInt(docs.granted.id))
                )
            );
        await expect(adapter().assertFresh(captured)).rejects.toMatchObject({ status: 409 });
        const persist = jest.fn();
        await expect(adapter().guardedCommit(captured, persist)).rejects.toMatchObject({
            status: 409,
        });
        expect(persist).not.toHaveBeenCalled();
        const refreshed = await capture();
        expect(refreshed.projection.status).toBe("partial");
        expect(JSON.stringify(refreshed.projection)).not.toContain(
            "Make invoice verification testable"
        );
    });
    it("rejects cloned, forged or foreign-instance captures before any persistence", async () => {
        const captured = await capture();
        for (const forged of [
            structuredClone(captured),
            { ...captured, actor: { ...captured.actor, companyId: B.toString() } },
        ]) {
            const persist = jest.fn();
            await expect(adapter().guardedCommit(forged, persist)).rejects.toBeDefined();
            expect(persist).not.toHaveBeenCalled();
        }
        const foreignInstance = createCompanyArchitectureAdapterV0({
            database: mockRealDb,
            now: () => new Date(reportWindow.asOf),
        });
        await expect(foreignInstance.assertFresh(captured)).rejects.toBeDefined();
    });
    it.each([
        "profile",
        "source-facts",
        "document-content",
        "document-version",
        "source-deleted",
        "document-deleted",
    ])(
        "invalidates captured context after %s changes, including same-timestamp content edits",
        async change => {
            const agendaId = randomUUID(),
                actionId = randomUUID();
            await connection.db.insert(vantageAgendas).values({
                id: agendaId,
                companyId: A,
                createdByUserId: actorId,
                weekStart: "2026-10-05",
                summary: "Preserved synthetic historical report",
            });
            await connection.db.insert(vantageCommitments).values({
                id: actionId,
                companyId: A,
                createdByUserId: actorId,
                agendaId,
                title: "Preserved human-created action",
                owner: "Synthetic founder",
                dueOn: "2026-10-16",
                test: "Record the synthetic acceptance result",
            });
            const beforeReports = await connection.db
                .select()
                .from(vantageAgendas)
                .where(eq(vantageAgendas.companyId, A));
            const beforeActions = await connection.db
                .select()
                .from(vantageCommitments)
                .where(eq(vantageCommitments.companyId, A));
            const captured = await capture();
            if (change === "profile") {
                metadata.company.description!.value = "Changed supplied profile claim.";
                await saveMetadata(metadata);
            }
            if (change === "source-facts")
                await connection.db
                    .update(companyProfileSources)
                    .set({
                        facts: {
                            company: {
                                description: sourceFact("Changed cached source claim", docs.open),
                            },
                        },
                        updatedAt: null,
                    })
                    .where(eq(companyProfileSources.documentId, BigInt(docs.open.id)));
            if (change === "document-content")
                await connection.db
                    .update(documentVersions)
                    .set({
                        ocrMetadata: {
                            text: "Changed native version payload without moving the version pointer",
                        },
                    })
                    .where(eq(documentVersions.id, docs.open.versionId));
            if (change === "document-version") {
                const [version] = await connection.db
                    .insert(documentVersions)
                    .values({
                        documentId: BigInt(docs.open.id),
                        versionNumber: 2,
                        url: `local://new-version/${randomUUID()}`,
                        mimeType: "text/plain",
                        ocrProcessed: true,
                        createdAt: stamp,
                    })
                    .returning({ id: documentVersions.id });
                await connection.db
                    .update(document)
                    .set({ currentVersionId: BigInt(version!.id), updatedAt: stamp })
                    .where(eq(document.id, docs.open.id));
            }
            if (change === "source-deleted")
                await connection.db
                    .delete(companyProfileSources)
                    .where(
                        and(
                            eq(companyProfileSources.companyId, A),
                            eq(companyProfileSources.documentId, BigInt(docs.open.id))
                        )
                    );
            if (change === "document-deleted")
                await connection.db
                    .delete(document)
                    .where(and(eq(document.companyId, A), eq(document.id, docs.open.id)));
            await expect(adapter().assertFresh(captured)).rejects.toMatchObject({ status: 409 });
            const persist = jest.fn();
            await expect(adapter().guardedCommit(captured, persist)).rejects.toMatchObject({
                status: 409,
            });
            expect(persist).not.toHaveBeenCalled();
            expect(
                await connection.db
                    .select()
                    .from(vantageAgendas)
                    .where(eq(vantageAgendas.companyId, A))
            ).toEqual(beforeReports);
            expect(
                await connection.db
                    .select()
                    .from(vantageCommitments)
                    .where(eq(vantageCommitments.companyId, A))
            ).toEqual(beforeActions);
        }
    );
    it.each(["membership", "permissions", "principal"])(
        "fails freshness after %s changes instead of trusting the captured actor",
        async change => {
            const captured = await capture();
            if (change === "membership")
                await connection.db
                    .update(userCompanyMemberships)
                    .set({ status: "suspended" })
                    .where(
                        and(
                            eq(userCompanyMemberships.companyId, A),
                            eq(userCompanyMemberships.userId, actorPk)
                        )
                    );
            if (change === "permissions")
                await connection.db
                    .update(workspaceRoles)
                    .set({ permissions: [] })
                    .where(eq(workspaceRoles.companyId, A));
            if (change === "principal")
                mockSession.mockResolvedValue({ user: { id: foreignActorId } });
            const persist = jest.fn();
            await expect(adapter().guardedCommit(captured, persist)).rejects.toBeDefined();
            expect(persist).not.toHaveBeenCalled();
        }
    );
    it("performs persistence on the guarded real transaction and rolls it back on callback failure", async () => {
        const agendaId = randomUUID();
        await connection.db.insert(vantageAgendas).values({
            id: agendaId,
            companyId: A,
            createdByUserId: actorId,
            weekStart: "2026-10-12",
            summary: "Original synthetic report",
        });
        const captured = await capture();
        const [before] = await connection.db
            .select({ summary: vantageAgendas.summary })
            .from(vantageAgendas)
            .where(eq(vantageAgendas.id, agendaId));
        await expect(
            adapter().guardedCommit(captured, async tx => {
                await tx
                    .update(vantageAgendas)
                    .set({ summary: "Synthetic rollback sentinel" })
                    .where(eq(vantageAgendas.id, agendaId));
                throw new Error("Synthetic persistence failure");
            })
        ).rejects.toThrow("Synthetic persistence failure");
        const [after] = await connection.db
            .select({ summary: vantageAgendas.summary })
            .from(vantageAgendas)
            .where(eq(vantageAgendas.id, agendaId));
        expect(after).toEqual(before);
        await expect(
            adapter().guardedCommit(captured, async tx => {
                await tx
                    .update(vantageAgendas)
                    .set({ summary: "Synthetic committed sentinel" })
                    .where(eq(vantageAgendas.id, agendaId));
                return "committed";
            })
        ).resolves.toBe("committed");
        const [committed] = await connection.db
            .select({ summary: vantageAgendas.summary })
            .from(vantageAgendas)
            .where(eq(vantageAgendas.id, agendaId));
        expect(committed!.summary).toBe("Synthetic committed sentinel");
    });
    it("keeps a concurrent ACL revocation blocked until guarded report persistence commits", async () => {
        const captured = await capture();
        let writer: Promise<unknown> | undefined;
        let writerCompleted = false;
        let resolvePid!: (pid: number) => void;
        const writerPid = new Promise<number>(resolve => {
            resolvePid = resolve;
        });
        try {
            await adapter().guardedCommit(captured, async _tx => {
                writer = connection.db.transaction(async writerTx => {
                    const [row] = await writerTx.execute(sql`SELECT pg_backend_pid() AS pid`);
                    resolvePid(Number(row!.pid));
                    await writerTx
                        .delete(documentGrants)
                        .where(
                            and(
                                eq(documentGrants.companyId, A),
                                eq(documentGrants.documentId, BigInt(docs.granted.id))
                            )
                        );
                    writerCompleted = true;
                });
                const pid = await writerPid;
                let waiting = false;
                for (let i = 0; i < 100 && !waiting; i++) {
                    const [row] =
                        await connection.client`SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${pid}`;
                    waiting = row?.wait_event_type === "Lock";
                    if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
                }
                expect(waiting).toBe(true);
                expect(writerCompleted).toBe(false);
                return "guarded persistence finished";
            });
        } finally {
            await writer;
        }
        expect(writerCompleted).toBe(true);
        await expect(adapter().assertFresh(captured)).rejects.toMatchObject({ status: 409 });
    });
});
