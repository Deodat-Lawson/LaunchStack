import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { eq, sql } from "drizzle-orm";
import { createTranslator } from "next-intl";

import { configureDatabase, createDb, type Db, type DbClient } from "@launchstack/store/client";
import { company } from "@launchstack/store/schema";
import {
    CatalogueProgramSchema,
    FIT_DIMENSION_KEYS,
    FIT_RUBRIC_VERSION,
    hashValue,
    type CatalogueProgram,
    type FitAssessmentV1,
} from "@launchstack/pipelines/accelerators";
import {
    getCatalogueProgram,
    importCatalogue,
    listCompanyMatches,
    saveCompanyMatches,
} from "@launchstack/pipelines/accelerators/db";
import {
    applyFactEdit,
    createEmptyMetadata,
    saveProfileLocked,
} from "@launchstack/pipelines/company-metadata";
import {
    createDefaultPorts,
    executeProposalRun,
    PROPOSAL_CREDITS,
    queueProposalRun,
    type ProposalPorts,
} from "@launchstack/pipelines/proposals";
import {
    claimRun,
    createApplication,
    findLiveRun,
    getApplication,
    getRun,
    getSection,
    listApplications,
    listRuns,
    listSections,
    loadOrgProfile,
    replaceSections,
    updateSection,
} from "@launchstack/pipelines/proposals/db";
import {
    proposalApplications,
    proposalRuns,
    proposalSections,
} from "@launchstack/pipelines/proposals/schema";

import { env } from "~/env";
import { loadMessages } from "~/i18n/messages";
import { assertAcceleratorAccess } from "~/server/accelerators/access";
import { prepareAcceleratorRun } from "~/server/accelerators/run";
import {
    loadAcceleratorProgram,
    loadAcceleratorRun,
    loadAccelerators,
} from "~/server/accelerators/service";
import { tokenAccounts, tokenTransactions } from "~/server/db/schema/credits";
import { createProposalPorts } from "~/server/proposals/ports";
import { loadApplication, loadApplications, loadRun, loadRuns } from "~/server/proposals/service";

import {
    createFounderWeeklyReviewTestDatabase,
    type FounderWeeklyReviewTestDatabase,
} from "../founderWeeklyReview/testDb";
import { makeWorkspaceContext } from "../helpers/workspace-context";

let mockActiveDb: DbClient | null = null;
jest.mock("~/server/db", () => ({
    get db() {
        if (!mockActiveDb) throw new Error("test database not ready");
        return mockActiveDb;
    },
}));
jest.mock("~/lib/storage", () => ({ uploadFile: jest.fn() }));
jest.mock("~/server/services/document-upload", () => ({ processDocumentUpload: jest.fn() }));
jest.mock("~/server/inngest/client", () => ({ inngest: { send: jest.fn() } }));

const describeDb = process.env.LAUNCHSTACK_TEST_DATABASE_URL ? describe : describe.skip;

const NO_EVIDENCE = { sourceIds: [], companyEvidenceIds: [] };

/** A saved fit-v1 result, distinguishable from a new run by its rated sector. */
function storedAssessment(): FitAssessmentV1 {
    return {
        rubricVersion: FIT_RUBRIC_VERSION,
        eligibility: { status: "unknown", note: "Admission is not verified." },
        dimensions: Object.fromEntries(
            FIT_DIMENSION_KEYS.map(key => [
                key,
                key === "sector"
                    ? {
                          score: 25,
                          applicable: true,
                          note: "The company builds a product for the target applicants.",
                          evidence: { sourceIds: ["official"], companyEvidenceIds: [1] },
                      }
                    : { score: null, applicable: true, note: "Unknown.", evidence: NO_EVIDENCE },
            ])
        ) as FitAssessmentV1["dimensions"],
    };
}

/**
 * What the model returns for one Program. The fixture profile has no numbered
 * company evidence, so every grade must be unknown.
 */
function modelAssessment() {
    return {
        eligibility: { status: "unknown", note: "Admission is not verified." },
        dimensions: Object.fromEntries(
            FIT_DIMENSION_KEYS.filter(key => key !== "portfolio").map(key => [
                key,
                { score: null, note: "The profile does not say.", ...NO_EVIDENCE },
            ])
        ),
    };
}

describeDb("Accelerator discovery persistence and Grants isolation", () => {
    jest.setTimeout(120_000);
    let fixture: FounderWeeklyReviewTestDatabase;
    let connection: Db;
    let program: CatalogueProgram;
    let companyId: bigint;
    let otherCompanyId: bigint;
    let previousMode: typeof env.server.DEPLOYMENT_MODE;

    beforeAll(async () => {
        fixture = await createFounderWeeklyReviewTestDatabase();
        const url = new URL(process.env.LAUNCHSTACK_TEST_DATABASE_URL!);
        url.pathname = `/${fixture.databaseName}`;
        connection = createDb({ url: url.toString(), maxConnections: 8 });
        configureDatabase(connection.db);
        mockActiveDb = connection.db;
        previousMode = env.server.DEPLOYMENT_MODE;
        env.server.DEPLOYMENT_MODE = "cloud";
        program = CatalogueProgramSchema.parse(
            JSON.parse(
                await readFile(
                    join(
                        __dirname,
                        "../../../../fixtures/accelerators/programs/abovea-startup-accelerator.json"
                    ),
                    "utf8"
                )
            )
        );
    });

    beforeEach(async () => {
        await importCatalogue([program]);
        const rows = await fixture.db
            .insert(company)
            .values([
                { name: "Accelerator regression", numberOfEmployees: "1" },
                { name: "Other company", numberOfEmployees: "1" },
            ])
            .returning({ id: company.id });
        companyId = BigInt(rows[0]!.id);
        otherCompanyId = BigInt(rows[1]!.id);
        const metadata = createEmptyMetadata(String(companyId));
        applyFactEdit(metadata, {
            path: "company.description",
            value: "We build a software product for growing companies.",
        });
        await saveProfileLocked(
            companyId,
            () => ({ metadata, diff: { added: [], updated: [], deprecated: [] } }),
            { changedBy: "regression-author" }
        );
    });

    afterAll(async () => {
        env.server.DEPLOYMENT_MODE = previousMode;
        mockActiveDb = null;
        await connection?.close();
        await fixture?.close();
    });

    const member = () =>
        makeWorkspaceContext({ companyId, authUserId: "regression-author", role: "owner" });

    async function historicalApplication() {
        const applicationId = randomUUID();
        const sectionId = randomUUID();
        await fixture.db.insert(proposalApplications).values({
            id: applicationId,
            companyId,
            title: "Private historical Accelerator Form",
            kind: "accelerator",
            programId: program.id,
            cycleId: program.cycles[0]!.id,
            formHash: "historical-form-hash",
            createdByUserId: "historical-author",
        });
        await fixture.db.insert(proposalSections).values({
            id: sectionId,
            companyId,
            applicationId,
            position: 0,
            key: "private-answer",
            question: "Private historical question",
            draft: "Private historical answer",
            revision: 4,
            status: "edited",
            formField: program.cycles[0]!.form?.fields[0] ?? null,
        });
        return { applicationId, sectionId };
    }

    async function meteringState() {
        const [accounts, transactions] = await Promise.all([
            fixture.db
                .select({
                    balance: tokenAccounts.balanceTokens,
                    used: tokenAccounts.lifetimeTokensUsed,
                })
                .from(tokenAccounts)
                .where(eq(tokenAccounts.companyId, companyId)),
            fixture.db
                .select({
                    amount: tokenTransactions.amount,
                    referenceId: tokenTransactions.referenceId,
                })
                .from(tokenTransactions)
                .where(eq(tokenTransactions.companyId, companyId)),
        ]);
        return { accounts, transactions };
    }

    it("imports a discovery Program with no Form while retaining its sourced preview and hash", async () => {
        const discovery = CatalogueProgramSchema.parse({
            ...program,
            cycles: program.cycles.map(({ form: _form, ...cycle }) => cycle),
        });
        expect(await importCatalogue([discovery])).toEqual({
            inserted: 0,
            updated: 1,
            unchanged: 0,
        });
        expect(await importCatalogue([discovery])).toEqual({
            inserted: 0,
            updated: 0,
            unchanged: 1,
        });
        expect(await getCatalogueProgram(program.id)).toEqual({
            program: discovery,
            contentHash: hashValue(discovery),
        });
        const preview = await loadAcceleratorProgram(member(), program.id);
        expect(preview.program).toEqual(discovery);
        expect(preview.program.cycles[0]).not.toHaveProperty("form");
        expect(preview).toMatchObject({ fit: null, freshness: { status: "not_assessed" } });
    });

    it("keeps historical private Forms outside discovery and Grants without deleting their answers", async () => {
        const { applicationId, sectionId } = await historicalApplication();
        const home = await loadAccelerators(member());
        expect(Object.keys(home).sort()).toEqual([
            "canEdit",
            "costs",
            "details",
            "profileReady",
            "programs",
        ]);
        expect(home).toMatchObject({
            profileReady: true,
            canEdit: true,
            costs: { matchPerProgram: PROPOSAL_CREDITS.programs },
        });
        expect(JSON.stringify(home)).not.toContain("Private historical");
        expect(await getApplication(applicationId, companyId)).toBeNull();
        expect(await listApplications(companyId)).toEqual([]);
        const grantsContext = { companyId, userId: "grant-author" };
        expect(await loadApplications(grantsContext)).toEqual([]);
        await expect(loadApplication(grantsContext, applicationId)).rejects.toMatchObject({
            status: 404,
        });
        expect(await getSection(companyId, sectionId)).toBeNull();
        expect(await listSections(companyId, applicationId)).toEqual([]);
        expect(await updateSection(companyId, sectionId, { draft: "Overwrite" })).toBeNull();
        const [saved] = await fixture.db
            .select()
            .from(proposalSections)
            .where(eq(proposalSections.id, sectionId));
        expect(saved).toMatchObject({ draft: "Private historical answer", revision: 4 });
    });

    it("keeps Grant creation and answer saves working alongside historical Accelerator rows", async () => {
        const { applicationId } = await historicalApplication();
        const grant = await createApplication({
            companyId,
            createdByUserId: "grant-author",
            title: "Grant regression",
            funder: null,
            opportunityId: null,
            deadline: null,
            requestText: null,
            requestUrl: null,
            requestDocumentId: null,
        });
        const [section] = await replaceSections(companyId, grant.id, [
            {
                key: "overview",
                question: "Describe the project",
                guidance: null,
                wordLimit: 200,
                required: true,
            },
        ]);
        await updateSection(companyId, section!.id, { draft: "Grant answer", status: "edited" });
        expect((await listApplications(companyId)).map(item => item.id)).toEqual([grant.id]);
        expect(await getSection(companyId, section!.id)).toMatchObject({
            draft: "Grant answer",
            status: "edited",
        });
        expect(await getApplication(grant.id, otherCompanyId)).toBeNull();
        await expect(
            queueProposalRun({
                companyId,
                userId: "grant-author",
                kind: "draft",
                input: { applicationId },
            })
        ).rejects.toMatchObject({ status: 404 });
    });

    it.each([
        ["accel_draft", "queued"],
        ["accel_draft", "running"],
        ["accel_edit", "queued"],
        ["accel_edit", "running"],
        ["draft", "queued"],
    ] as const)(
        "never exposes, claims, charges, or lets a historical %s %s run block matching",
        async (kind, status) => {
            const { applicationId } = await historicalApplication();
            const runApplicationId = kind === "draft" ? applicationId : null;
            const id = randomUUID();
            const historicalResult = {
                kind: "accel_edit",
                suggestion: { replacement: "Private historical suggestion" },
            };
            await fixture.db.insert(proposalRuns).values({
                id,
                companyId,
                kind: sql`${kind}`,
                status,
                applicationId: runApplicationId,
                userId: "historical-author",
                input: runApplicationId ? { applicationId: runApplicationId } : {},
                result: historicalResult,
                createdAt: new Date("2025-01-01T00:00:00Z"),
                startedAt: status === "running" ? new Date("2025-01-01T00:00:00Z") : null,
            });
            expect(await getRun(id, companyId)).toBeNull();
            expect(await getRun(id, companyId, { includeAccelerators: true })).toBeNull();
            expect(await listRuns(companyId, { includeAccelerators: true })).toEqual([]);
            const grantsContext = { companyId, userId: "grant-author" };
            expect(await loadRuns(grantsContext)).toEqual([]);
            await expect(loadRun(grantsContext, id)).rejects.toMatchObject({ status: 404 });
            expect(await findLiveRun(companyId, { includeAccelerators: true })).toBeNull();
            expect(await claimRun(companyId, id)).toBeNull();
            await expect(loadAcceleratorRun(member(), id)).rejects.toMatchObject({ status: 404 });
            const ports = createDefaultPorts({
                debitCredits: async () => {
                    throw new Error("Retired run attempted a debit");
                },
            });
            await expect(
                executeProposalRun(
                    {
                        runId: id,
                        companyId,
                        userId: "historical-author",
                        scope: { kind: "everything" },
                    },
                    ports
                )
            ).rejects.toThrow("Run not found");
            const live = await queueProposalRun({
                companyId,
                userId: "regression-author",
                kind: "programs",
                input: {},
            });
            expect(live.kind).toBe("programs");
            expect(await meteringState()).toEqual({ accounts: [], transactions: [] });
            const [stored] = await fixture.db
                .select()
                .from(proposalRuns)
                .where(eq(proposalRuns.id, id));
            expect(stored).toMatchObject({ status, creditsUsed: 0, result: historicalResult });
        }
    );

    it("serializes simultaneous matching requests and hides their progress from Grants and other companies", async () => {
        const runs = await Promise.allSettled([
            queueProposalRun({ companyId, userId: "one", kind: "programs", input: {} }),
            queueProposalRun({ companyId, userId: "two", kind: "programs", input: {} }),
        ]);
        const started = runs.find(run => run.status === "fulfilled")!;
        expect(runs.filter(run => run.status === "fulfilled")).toHaveLength(1);
        const rejected = runs.find(run => run.status === "rejected")!;
        expect(rejected.reason).toMatchObject({ status: 409, code: "run_in_progress" });
        expect(await getRun(started.value.id, companyId)).toBeNull();
        expect(await listRuns(companyId)).toEqual([]);
        expect(await findLiveRun(companyId)).toBeNull();
        expect(
            await getRun(started.value.id, otherCompanyId, { includeAccelerators: true })
        ).toBeNull();
        const progress = await loadAcceleratorRun(member(), started.value.id);
        expect(progress).toMatchObject({ kind: "programs", status: "queued", creditsUsed: 0 });
        expect(progress).not.toHaveProperty("result");
    });

    it.each([
        "success",
        "self-host recording",
        "revoked access",
        "insufficient credits",
        "debit error",
    ] as const)("commits matching and the actual app debit atomically on %s", async outcome => {
        env.server.DEPLOYMENT_MODE = outcome === "self-host recording" ? "self-hosted" : "cloud";
        const originalFit = storedAssessment();
        const originalHash = "previous-profile";
        await saveCompanyMatches(companyId, originalHash, [
            {
                programId: program.id,
                programHash: hashValue(program),
                assessment: originalFit,
            },
        ]);
        const previousMatches = await listCompanyMatches(companyId);
        const balance =
            outcome === "insufficient credits" || outcome === "self-host recording" ? 0 : 10_000;
        await fixture.db.insert(tokenAccounts).values({ companyId, balanceTokens: balance });
        const run = await queueProposalRun({
            companyId,
            userId: "regression-author",
            kind: "programs",
            input: { programs: { programIds: [program.id] } },
        });
        let currentMember = member();
        const meter = createProposalPorts(companyId).debitCredits!;
        const ports: ProposalPorts = {
            ...createDefaultPorts({ enableFetch: false }),
            structured: async (_stage, schema) => {
                if (outcome === "revoked access") {
                    currentMember = makeWorkspaceContext({
                        companyId,
                        scope: {
                            kind: "only",
                            allowedCategories: [],
                            deniedDocumentIds: [],
                            allowedDocumentIds: [],
                        },
                    });
                }
                return {
                    result: schema.parse({ assessments: { [program.id]: modelAssessment() } }),
                    modelId: "matching-fixture",
                };
            },
            debitCredits: async (args, tx) => {
                await meter(args, tx);
                if (outcome === "debit error") throw new Error("debit error");
            },
            assertAcceleratorAccess: () => assertAcceleratorAccess(currentMember, "documents.edit"),
        };
        ports.prepareAcceleratorRun = (ctx, record) => prepareAcceleratorRun(ctx, ports, record);
        const ctx = {
            runId: run.id,
            companyId,
            userId: "regression-author",
            scope: { kind: "everything" } as const,
        };
        const finished = await executeProposalRun(ctx, ports);
        const state = await meteringState();
        if (outcome === "success" || outcome === "self-host recording") {
            expect(finished).toMatchObject({
                status: "completed",
                creditsUsed: PROPOSAL_CREDITS.programs,
                summary: { counts: { matched: 1 } },
            });
            expect(finished.steps.every(step => step.status === "done")).toBe(true);
            const profile = await loadOrgProfile(companyId, { kind: "everything" });
            expect(await listCompanyMatches(companyId)).toMatchObject({
                [program.id]: {
                    assessment: {
                        rubricVersion: FIT_RUBRIC_VERSION,
                        dimensions: {
                            sector: { score: null, applicable: true },
                            portfolio: { score: null, applicable: false },
                        },
                    },
                    rubricVersion: FIT_RUBRIC_VERSION,
                    profileHash: hashValue(profile),
                    programHash: hashValue(program),
                },
            });
            expect(await listCompanyMatches(otherCompanyId)).toEqual({});
            expect((await loadAccelerators(member())).programs[0]).toMatchObject({
                fit: { overall: { score: null, coverage: 0 } },
                freshness: { status: "current" },
            });
            expect(state).toEqual({
                accounts: [
                    {
                        balance: balance - PROPOSAL_CREDITS.programs,
                        used: PROPOSAL_CREDITS.programs,
                    },
                ],
                transactions: [{ amount: -PROPOSAL_CREDITS.programs, referenceId: run.id }],
            });
            expect(await executeProposalRun(ctx, ports)).toMatchObject({
                status: "completed",
                creditsUsed: PROPOSAL_CREDITS.programs,
            });
            expect(await meteringState()).toEqual(state);
        } else {
            expect(finished).toMatchObject({ status: "failed", creditsUsed: 0 });
            expect(await listCompanyMatches(companyId)).toEqual(previousMatches);
            expect(state).toEqual({ accounts: [{ balance, used: 0 }], transactions: [] });
            if (outcome === "insufficient credits") {
                const response = await loadAcceleratorRun(member(), run.id);
                expect(response.errorCopy).toBeDefined();
                const translate = createTranslator({
                    locale: "zh-CN",
                    messages: await loadMessages("zh-CN"),
                });
                expect(
                    translate(response.errorCopy!.key, response.errorCopy!.values as never)
                ).toMatch(/\p{Script=Han}/u);
            }
        }
    });
});
