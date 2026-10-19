/**
 * Run the actual inline callback and worker handler against migrated Postgres.
 * Only the external schedulers, model/embedding providers and credit ledger are
 * stand-ins: membership resolution, document-scope SQL, ensemble retrieval,
 * profile/library loading, prompt assembly and saved draft evidence are real.
 *
 * The model returns neutral text, not the private fixture phrases. Finding one
 * of those phrases at the model boundary or in saved evidence is a real leak,
 * not a model response planted by the test.
 */
import { and, eq } from "drizzle-orm";
import type { z } from "zod";

import { configureDatabase, type DbClient } from "@launchstack/store/client";
import {
    company,
    document,
    documentContextChunks,
    documentVersions,
} from "@launchstack/store/schema";
import { configureRag, type RagSearchResult } from "@launchstack/retrieval";
import { createEmptyMetadata, type MetadataFact } from "@launchstack/pipelines/company-metadata";
import {
    createApplication,
    createLibraryItem,
    deleteApplication,
    getLibraryItem,
    getRun,
    listSections,
    replaceSections,
    updateSection,
} from "@launchstack/pipelines/proposals/db";
import type { ProposalRunEventData } from "@launchstack/pipelines/proposals";
import { proposalLibraryItems, proposalRuns } from "@launchstack/pipelines/proposals/schema";
import { companyMetadata } from "@launchstack/tools/company-context/schema";

import { resolveMemberContext } from "~/lib/require-workspace-context";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import {
    documentGrants,
    documentSettings,
    userCompanyMemberships,
    users,
} from "~/server/db/schema";
import { proposalsRunJob } from "~/server/inngest/functions/proposalsRun";
import { startProposalRun, type ProposalsExecutor } from "~/server/proposals/executor";
import { newLibraryItem, saveSectionToLibrary } from "~/server/proposals/service";
import { createAppRagPort } from "~/server/rag/port";

import {
    createFounderWeeklyReviewTestDatabase,
    type FounderWeeklyReviewTestDatabase,
} from "../founderWeeklyReview/testDb";

let mockActiveDb: DbClient | null = null;
const mockAfterCallbacks: Array<() => Promise<void>> = [];
const mockEvents: ProposalRunEventData[] = [];
const mockPrompts: string[] = [];
const mockRetrievals: RagSearchResult[][] = [];
const mockDebitCredits = jest.fn(async (_args: unknown) => undefined);
let mockDraftUsesPrivateProfile = false;

type WorkerHandler = (ctx: {
    event: { data: ProposalRunEventData };
    step: { run: <T>(name: string, op: () => Promise<T>) => Promise<T> };
}) => Promise<unknown>;
type WorkerOptions = {
    onFailure: (ctx: {
        error: Error;
        event: { data: { event: { data: ProposalRunEventData } } };
    }) => Promise<void>;
};

jest.mock("~/server/db", () => ({
    get db() {
        if (!mockActiveDb) throw new Error("test database not ready");
        return mockActiveDb;
    },
}));
jest.mock("~/server/auth", () => ({ getServerSession: jest.fn() }));
jest.mock("next/server", () => ({
    ...jest.requireActual("next/server"),
    after: (callback: () => Promise<void>) => mockAfterCallbacks.push(callback),
}));
jest.mock("~/server/inngest/client", () => ({
    inngest: {
        send: async ({ data }: { data: ProposalRunEventData }) => {
            mockEvents.push(data);
            return { ids: ["scope-test-event"] };
        },
        createFunction: (options: WorkerOptions, _trigger: unknown, handler: WorkerHandler) => ({
            options,
            handler,
        }),
    },
}));
jest.mock("~/lib/credits", () => ({
    hasTokens: async () => true,
    debitTokens: (args: unknown) => mockDebitCredits(args),
}));
jest.mock("@launchstack/llm/embeddings", () => ({
    ...jest.requireActual("@launchstack/llm/embeddings"),
    createEmbeddingModel: ({ dimension }: { dimension: number }) => ({
        embedQuery: async () => Array.from({ length: dimension }, () => 0.001),
        embedDocuments: async (texts: string[]) =>
            texts.map(() => Array.from({ length: dimension }, () => 0.001)),
    }),
}));
jest.mock("@launchstack/llm", () => ({
    ...jest.requireActual("@launchstack/llm"),
    resolveChatModel: () => ({ modelId: "scope-regression-model" }),
    invokeStructured: async (
        _resolved: unknown,
        schema: z.ZodType,
        messages: Array<{ content: unknown }>,
        options: { name: string }
    ) => {
        const prompt = messages.map(message => String(message.content)).join("\n");
        mockPrompts.push(prompt);
        if (options.name === "application_review")
            return schema.parse({ summary: "The public draft is ready for review.", findings: [] });
        return schema.parse({
            draft:
                mockDraftUsesPrivateProfile && prompt.includes(RESTRICTED_FACT)
                    ? `Our planned budget is ${RESTRICTED_FACT}`
                    : "Our reading programme supports learners in the community.",
            cites: [1, 2, 3, 4, 5, 6, 7, 8],
            gaps: [],
        });
    },
}));

const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;
const QUESTION = "Describe zebra programme outcomes and learner impact.";
const PUBLIC_CHUNK = "Zebra programme outcomes: the reading programme served 120 learners.";
const RESTRICTED_CHUNK =
    "Zebra programme outcomes: PRIVATE_BOARD_TARGET reserves funding for 913 learners.";
const PUBLIC_PROFILE = "The community reading programme is open to all.";
const RESTRICTED_SUMMARY = "PROFILE_ONLY_SUMMARY: the board plans a confidential acquisition.";
const RESTRICTED_FACT = "PROFILE_ONLY_BUDGET: the confidential acquisition costs $7 million.";
const PUBLIC_ANSWER = "LIBRARY_PUBLIC_ANSWER: learners receive weekly reading support.";
const RESTRICTED_ANSWER = "LIBRARY_PRIVATE_ANSWER: the board will divert the acquisition reserve.";
const NOW = new Date("2026-10-19T00:00:00Z");
const job = proposalsRunJob as unknown as { options: WorkerOptions; handler: WorkerHandler };
const NON_RETRIEVING_RUNS: Array<[ProposalsExecutor, "rewrite" | "review"]> = [
    ["inline", "rewrite"],
    ["inline", "review"],
    ["worker", "rewrite"],
    ["worker", "review"],
];
const SAVED_REQUEST_EVIDENCE: Array<
    [ProposalsExecutor, "empty" | "public", "retained" | "deleted"]
> = [
    ["inline", "empty", "retained"],
    ["inline", "public", "retained"],
    ["worker", "empty", "retained"],
    ["worker", "public", "retained"],
    ["inline", "empty", "deleted"],
    ["inline", "public", "deleted"],
    ["worker", "empty", "deleted"],
    ["worker", "public", "deleted"],
];

type Person = "ada" | "bea" | "cy";

function documentIdOf(hit: RagSearchResult): number {
    return Number(hit.metadata.documentId ?? hit.documentId);
}

describeDb("proposal runs keep the stored writer's document scope (integration)", () => {
    jest.setTimeout(120_000);

    let test: FounderWeeklyReviewTestDatabase;
    let companyId: bigint;
    let publicDocumentId: number;
    let restrictedDocumentId: number;
    let restrictedLibraryId: string;
    const pk = {} as Record<Person, bigint>;
    const originalExecutor = process.env.PROPOSALS_EXECUTOR;

    async function addDocument(title: string, content: string): Promise<number> {
        const [doc] = await test.db
            .insert(document)
            .values({ companyId, title, category: "Team", url: `local://${title}` })
            .returning({ id: document.id });
        const [version] = await test.db
            .insert(documentVersions)
            .values({
                documentId: BigInt(doc!.id),
                versionNumber: 1,
                url: `local://${title}`,
                mimeType: "text/markdown",
            })
            .returning({ id: documentVersions.id });
        await test.db
            .update(document)
            .set({ currentVersionId: BigInt(version!.id) })
            .where(eq(document.id, doc!.id));
        await test.db.insert(documentContextChunks).values({
            documentId: BigInt(doc!.id),
            versionId: BigInt(version!.id),
            content,
            pageNumber: 1,
            charCount: content.length,
        });
        return doc!.id;
    }

    function fact(
        value: string,
        documentId: number,
        quote = documentId === publicDocumentId ? PUBLIC_CHUNK : RESTRICTED_CHUNK
    ): MetadataFact {
        return {
            value,
            visibility: "public",
            usage: "outreach_ok",
            confidence: 0.95,
            priority: "normal",
            status: "active",
            last_updated: NOW.toISOString(),
            sources: [
                {
                    doc_id: documentId,
                    doc_name:
                        documentId === publicDocumentId ? "Programme report" : "Board minutes",
                    extracted_at: NOW.toISOString(),
                    page: 1,
                    quote,
                },
            ],
        };
    }

    async function inIsolatedWorkspace(run: () => Promise<void>): Promise<void> {
        const previousCompanyId = companyId;
        const [co] = await test.db
            .insert(company)
            .values({ name: "Isolated generation provenance", numberOfEmployees: "20" })
            .returning({ id: company.id });
        const isolatedCompanyId = BigInt(co!.id);
        companyId = isolatedCompanyId;
        try {
            for (const person of ["ada", "bea"] as const)
                await test.db.insert(userCompanyMemberships).values({
                    userId: pk[person],
                    companyId,
                    role: "member",
                    status: "active",
                });
            await run();
        } finally {
            companyId = previousCompanyId;
            await test.db.delete(company).where(eq(company.id, Number(isolatedCompanyId)));
        }
    }

    async function addUnindexedPrivateDocument(): Promise<number> {
        const [source] = await test.db
            .insert(document)
            .values({
                companyId,
                title: "Board minutes",
                category: "Team",
                url: "local://private-origin-without-retrieval-chunks",
            })
            .returning({ id: document.id });
        await test.db.insert(documentSettings).values({
            companyId,
            documentId: BigInt(source!.id),
            restricted: true,
            updatedBy: "auth_ada",
        });
        await test.db.insert(documentGrants).values({
            companyId,
            documentId: BigInt(source!.id),
            principalType: "user",
            principalId: pk.ada.toString(),
            level: "manage",
            grantedBy: "auth_ada",
        });
        return source!.id;
    }

    beforeAll(async () => {
        test = await createFounderWeeklyReviewTestDatabase();
        mockActiveDb = test.db;
        configureDatabase(test.db);
        const realRag = createAppRagPort();
        configureRag({
            async companyEnsembleSearch(query, options) {
                const hits = await realRag.companyEnsembleSearch(query, options);
                mockRetrievals.push(hits);
                return hits;
            },
        });

        const [co] = await test.db
            .insert(company)
            .values({ name: "Zebra Reading", numberOfEmployees: "20" })
            .returning({ id: company.id });
        companyId = BigInt(co!.id);
        for (const name of ["ada", "bea", "cy"] as const) {
            const [person] = await test.db
                .insert(users)
                .values({
                    name,
                    email: `${name}@zebra.test`,
                    userId: `auth_${name}`,
                    companyId,
                })
                .returning({ id: users.id });
            pk[name] = BigInt(person!.id);
            await test.db.insert(userCompanyMemberships).values({
                userId: pk[name],
                companyId,
                role: "member",
                status: "active",
            });
        }
        publicDocumentId = await addDocument("Programme report", PUBLIC_CHUNK);
        restrictedDocumentId = await addDocument("Board minutes", RESTRICTED_CHUNK);
        await test.db.insert(documentSettings).values({
            documentId: BigInt(restrictedDocumentId),
            companyId,
            restricted: true,
            updatedBy: "auth_ada",
        });
        await test.db.insert(documentGrants).values({
            companyId,
            documentId: BigInt(restrictedDocumentId),
            principalType: "user",
            principalId: pk.ada.toString(),
            level: "manage",
            grantedBy: "auth_ada",
        });

        const metadata = createEmptyMetadata(companyId.toString(), NOW);
        metadata.company.description = fact(PUBLIC_PROFILE, publicDocumentId);
        metadata.profile = {
            summary: fact(RESTRICTED_SUMMARY, restrictedDocumentId),
            facts: {
                annual_budget: {
                    ...fact(RESTRICTED_FACT, restrictedDocumentId),
                    label: "Annual budget",
                },
            },
        };
        await test.db.insert(companyMetadata).values({ companyId, metadata, builtAt: NOW });
        for (const [documentId, answer] of [
            [publicDocumentId, PUBLIC_ANSWER],
            [restrictedDocumentId, RESTRICTED_ANSWER],
        ] as const) {
            const item = await createLibraryItem({
                companyId,
                createdByUserId: "auth_ada",
                question: QUESTION,
                answer,
                tags: ["programme outcomes"],
                evidence: [
                    {
                        n: 1,
                        documentId,
                        title:
                            documentId === publicDocumentId ? "Programme report" : "Board minutes",
                        page: 1,
                        quote: documentId === publicDocumentId ? PUBLIC_CHUNK : RESTRICTED_CHUNK,
                        url: null,
                    },
                ],
                provenance: { kind: "sources", sourceDocumentIds: [documentId] },
                sourceApplicationId: null,
                sourceSectionKey: null,
            });
            if (documentId === restrictedDocumentId) restrictedLibraryId = item.id;
        }
    });

    beforeEach(() => {
        mockAfterCallbacks.length = 0;
        mockEvents.length = 0;
        mockPrompts.length = 0;
        mockRetrievals.length = 0;
        mockDraftUsesPrivateProfile = false;
        mockDebitCredits.mockClear();
    });

    afterEach(() => {
        if (originalExecutor === undefined) delete process.env.PROPOSALS_EXECUTOR;
        else process.env.PROPOSALS_EXECUTOR = originalExecutor;
    });

    afterAll(async () => {
        mockActiveDb = null;
        await test?.close();
    });

    async function schedule(
        executor: ProposalsExecutor,
        writer: Person,
        eventActor = writer,
        kind: "draft" | "rewrite" | "review" = "draft",
        existingApplicationId?: string
    ) {
        process.env.PROPOSALS_EXECUTOR = executor;
        const application = existingApplicationId
            ? { id: existingApplicationId }
            : await createApplication({
                  companyId,
                  createdByUserId: `auth_${writer}`,
                  title: "Zebra learner grant",
                  funder: "Community Foundation",
                  opportunityId: null,
                  deadline: null,
                  requestText: null,
                  requestUrl: null,
                  requestDocumentId: null,
              });
        const [section] = await replaceSections(companyId, application.id, [
            { key: "impact", question: QUESTION, guidance: null, wordLimit: 300, required: true },
        ]);
        const run = await startProposalRun({
            companyId,
            userId: `auth_${writer}`,
            kind,
            input: {
                applicationId: application.id,
                ...(kind === "rewrite" ? { sectionIds: [section!.id] } : {}),
            },
            sectionLabels: ["Impact"],
        });
        expect(run.status).toBe("queued");
        const callback = executor === "inline" ? mockAfterCallbacks.shift() : undefined;
        const event = executor === "worker" ? mockEvents.shift() : undefined;
        if (executor === "inline" && !callback) throw new Error("after() did not receive the run");
        if (executor === "worker" && !event) throw new Error("Inngest did not receive the run");

        return {
            run,
            applicationId: application.id,
            sectionId: section!.id,
            async execute() {
                mockPrompts.length = 0;
                mockRetrievals.length = 0;
                let schedulerResult: unknown;
                if (callback) await callback();
                else {
                    const data = { ...event!, userId: `auth_${eventActor}` };
                    try {
                        schedulerResult = await job.handler({
                            event: { data },
                            step: { run: async (_name, op) => op() },
                        });
                    } catch (error) {
                        // Inngest invokes onFailure after the final unsuccessful attempt.
                        await job.options.onFailure({
                            error: error instanceof Error ? error : new Error(String(error)),
                            event: { data: { event: { data } } },
                        });
                    }
                }
                const saved = await getRun(run.id, companyId);
                const [section] = await listSections(companyId, application.id);
                return {
                    run: saved!,
                    section: section!,
                    prompt: mockPrompts.join("\n"),
                    hits: mockRetrievals.flat(),
                    schedulerResult,
                };
            },
        };
    }

    it.each<ProposalsExecutor>(["inline", "worker"])(
        "%s excludes unreadable documents, derived profile facts and saved answers from generation",
        async executor => {
            // First establish that this is a real restriction, using the same
            // membership resolver and SQL predicate the execution path must use.
            const writer = await resolveMemberContext("auth_bea", companyId);
            expect(writer).not.toBeNull();
            const readable = await test.db
                .select({ id: document.id })
                .from(document)
                .where(scopedDocumentWhere(companyId, await writer!.documentScope()));
            expect(readable.map(row => row.id)).toEqual([publicDocumentId]);

            const granted = await (await schedule(executor, "ada")).execute();
            expect(granted.run.status).toBe("completed");
            expect(granted.hits.map(documentIdOf)).toContain(restrictedDocumentId);
            for (const phrase of [
                RESTRICTED_CHUNK,
                RESTRICTED_SUMMARY,
                RESTRICTED_FACT,
                RESTRICTED_ANSWER,
            ])
                expect(granted.prompt).toContain(phrase);
            expect(granted.section.draftMeta?.evidence.map(item => item.documentId)).toContain(
                restrictedDocumentId
            );

            // The worker event deliberately names the granted writer, while the
            // persisted run belongs to Bea. An event must not upgrade its actor.
            const outside = await (await schedule(executor, "bea", "ada")).execute();
            expect(outside.run.status).toBe("completed");
            expect(outside.hits.map(documentIdOf)).toContain(publicDocumentId);
            for (const phrase of [PUBLIC_CHUNK, PUBLIC_PROFILE, PUBLIC_ANSWER])
                expect(outside.prompt).toContain(phrase);
            expect(outside.section.draftMeta?.evidence.map(item => item.documentId)).toContain(
                publicDocumentId
            );
            expect({
                retrievedRestrictedSources: outside.hits.filter(
                    hit => documentIdOf(hit) === restrictedDocumentId
                ),
                privatePhrasesSentToModel: [
                    RESTRICTED_CHUNK,
                    RESTRICTED_SUMMARY,
                    RESTRICTED_FACT,
                    RESTRICTED_ANSWER,
                ].filter(phrase => outside.prompt.includes(phrase)),
                savedRestrictedEvidence: outside.section.draftMeta?.evidence.filter(
                    item => item.documentId === restrictedDocumentId
                ),
                savedRestrictedLibraryIds: outside.section.draftMeta?.libraryItemIds.filter(
                    id => id === restrictedLibraryId
                ),
            }).toEqual({
                retrievedRestrictedSources: [],
                privatePhrasesSentToModel: [],
                savedRestrictedEvidence: [],
                savedRestrictedLibraryIds: [],
            });
        }
    );

    it.each(NON_RETRIEVING_RUNS)(
        "%s %s scopes the organisation profile without retrieving new evidence",
        async (executor, kind) => {
            const pending = await schedule(executor, "bea", "bea", kind);
            await updateSection(companyId, pending.sectionId, {
                draft: "Our programme served 120 learners.",
                status: "drafted",
                draftMeta: {
                    cites: [1],
                    gaps: [],
                    libraryItemIds: [],
                    sourceDocumentIds: [publicDocumentId],
                    evidence: [
                        {
                            n: 1,
                            documentId: publicDocumentId,
                            title: "Programme report",
                            page: 1,
                            quote: PUBLIC_CHUNK,
                            url: null,
                        },
                    ],
                },
            });
            const outcome = await pending.execute();
            expect(outcome.run.status).toBe("completed");
            expect(mockRetrievals).toHaveLength(0);
            expect(mockPrompts).toHaveLength(1);
            expect(outcome.prompt).toContain(PUBLIC_PROFILE);
            expect(outcome.prompt).not.toContain(RESTRICTED_SUMMARY);
            expect(outcome.prompt).not.toContain(RESTRICTED_FACT);
        }
    );

    it.each(NON_RETRIEVING_RUNS)(
        "%s %s does not send a prior draft with unreadable evidence to the model",
        async (executor, kind) => {
            const pending = await schedule(executor, "bea", "bea", kind);
            await updateSection(companyId, pending.sectionId, {
                draft: RESTRICTED_CHUNK,
                status: "drafted",
                draftMeta: {
                    cites: [1],
                    gaps: [],
                    libraryItemIds: [],
                    evidence: [
                        {
                            n: 1,
                            documentId: restrictedDocumentId,
                            title: "Board minutes",
                            page: 1,
                            quote: RESTRICTED_CHUNK,
                            url: null,
                        },
                    ],
                },
            });
            const outcome = await pending.execute();
            expect(outcome.run.status).toBe("failed");
            expect(outcome.run.error).toMatch(/evidence.*(read|access)/i);
            expect(mockRetrievals).toHaveLength(0);
            expect(mockPrompts).toHaveLength(0);
            expect(mockDebitCredits).not.toHaveBeenCalled();
        }
    );

    it.each(NON_RETRIEVING_RUNS)(
        "%s %s does not send a prior draft derived from an unreadable saved answer to the model",
        async (executor, kind) => {
            const pending = await schedule(executor, "bea", "bea", kind);
            await updateSection(companyId, pending.sectionId, {
                draft: RESTRICTED_ANSWER,
                status: "drafted",
                draftMeta: {
                    cites: [],
                    gaps: [],
                    libraryItemIds: [restrictedLibraryId],
                    evidence: [],
                },
            });
            const outcome = await pending.execute();
            expect(outcome.run.status).toBe("failed");
            expect(outcome.run.error).toMatch(/evidence.*(read|access)/i);
            expect(mockRetrievals).toHaveLength(0);
            expect(mockPrompts).toHaveLength(0);
            expect(mockDebitCredits).not.toHaveBeenCalled();
        }
    );

    it.each(NON_RETRIEVING_RUNS)(
        "%s %s refuses legacy generated prose with unknown source provenance in a constrained scope",
        async (executor, kind) => {
            await inIsolatedWorkspace(async () => {
                const publicId = await addDocument("Programme report", PUBLIC_CHUNK);
                await addUnindexedPrivateDocument();
                const pending = await schedule(executor, "bea", "bea", kind);
                await updateSection(companyId, pending.sectionId, {
                    draft: `A legacy generated answer says ${RESTRICTED_FACT}`,
                    status: "drafted",
                    draftMeta: {
                        cites: [1],
                        gaps: [],
                        libraryItemIds: [],
                        modelId: "legacy-profile-copy",
                        promptVersion: "legacy",
                        draftedAt: NOW.toISOString(),
                        evidence: [
                            {
                                n: 1,
                                documentId: publicId,
                                title: "Programme report",
                                page: 1,
                                quote: PUBLIC_CHUNK,
                                url: null,
                            },
                        ],
                    },
                });
                const outside = await pending.execute();
                expect({
                    status: outside.run.status,
                    hasVisibleError: !!outside.run.error,
                    privateFactSentToModel: outside.prompt.includes(RESTRICTED_FACT),
                    retrievals: mockRetrievals.length,
                    modelCalls: mockPrompts.length,
                    debits: mockDebitCredits.mock.calls.length,
                }).toEqual({
                    status: "failed",
                    hasVisibleError: true,
                    privateFactSentToModel: false,
                    retrievals: 0,
                    modelCalls: 0,
                    debits: 0,
                });
            });
        }
    );

    it.each(NON_RETRIEVING_RUNS)(
        "%s %s refuses prior generated prose carrying a profile-only private fact despite public retrieval",
        async (executor, kind) => {
            await inIsolatedWorkspace(async () => {
                const publicId = await addDocument("Programme report", PUBLIC_CHUNK);
                const profileSourceId = await addUnindexedPrivateDocument();
                const privateFact = fact(RESTRICTED_FACT, profileSourceId, RESTRICTED_FACT);
                for (const source of privateFact.sources) delete source.quote;
                const metadata = createEmptyMetadata(companyId.toString(), NOW);
                metadata.profile = {
                    facts: {
                        annual_budget: {
                            ...privateFact,
                            label: "Annual budget",
                        },
                    },
                };
                await test.db.insert(companyMetadata).values({ companyId, metadata, builtAt: NOW });

                // The canned model copies a fact only when that actual profile
                // value reaches its prompt. The private source has no chunks,
                // so retrieval cannot accidentally supply its provenance.
                mockDraftUsesPrivateProfile = true;
                const first = await schedule(executor, "ada");
                const granted = await first.execute();
                expect(granted.run.status).toBe("completed");
                expect(granted.prompt).toContain(RESTRICTED_FACT);
                expect(granted.section.draft).toContain(RESTRICTED_FACT);
                expect(granted.hits.length).toBeGreaterThan(0);
                expect(granted.hits.every(hit => documentIdOf(hit) === publicId)).toBe(true);
                expect(granted.section.draftMeta?.evidence.length).toBeGreaterThan(0);
                expect(
                    granted.section.draftMeta?.evidence.every(item => item.documentId === publicId)
                ).toBe(true);
                expect(granted.section.draftMeta?.sourceDocumentIds).toEqual(
                    expect.arrayContaining([publicId, profileSourceId])
                );
                const saved = await saveSectionToLibrary(
                    { companyId, userId: "auth_ada" },
                    first.applicationId,
                    first.sectionId,
                    ["programme outcomes"]
                );
                const reused = await (await schedule(executor, "bea")).execute();
                expect(reused.run.status).toBe("completed");
                expect(reused.prompt).not.toContain(RESTRICTED_FACT);
                expect(reused.section.draftMeta?.libraryItemIds).not.toContain(saved.id);

                const pending = await schedule(executor, "bea", "bea", kind, first.applicationId);
                mockDebitCredits.mockClear();
                const outside = await pending.execute();
                expect({
                    status: outside.run.status,
                    hasVisibleError: !!outside.run.error,
                    privateFactSentToModel: outside.prompt.includes(RESTRICTED_FACT),
                    retrievals: mockRetrievals.length,
                    modelCalls: mockPrompts.length,
                    debits: mockDebitCredits.mock.calls.length,
                }).toEqual({
                    status: "failed",
                    hasVisibleError: true,
                    privateFactSentToModel: false,
                    retrievals: 0,
                    modelCalls: 0,
                    debits: 0,
                });
            });
        }
    );

    it.each<ProposalsExecutor>(["inline", "worker"])(
        "%s decodes legacy library evidence without treating unknown origin as manual",
        async executor => {
            await inIsolatedWorkspace(async () => {
                await addDocument("Programme report", PUBLIC_CHUNK);
                await addUnindexedPrivateDocument();
                const legacyAnswer =
                    "LEGACY_UNKNOWN_ANSWER: a private source may have supplied this.";
                const legacy = await newLibraryItem(
                    { companyId, userId: "auth_ada" },
                    { question: QUESTION, answer: legacyAnswer }
                );
                // Legacy storage had only an array: null origin fields cannot
                // turn lost dependency proof into an explicit manual snapshot.
                await test.db
                    .update(proposalLibraryItems)
                    .set({ evidence: [] })
                    .where(
                        and(
                            eq(proposalLibraryItems.id, legacy.id),
                            eq(proposalLibraryItems.companyId, companyId)
                        )
                    );
                const decoded = await getLibraryItem(companyId, legacy.id);
                expect(decoded?.evidence).toEqual([]);
                expect(decoded?.provenance).toEqual({ kind: "unknown" });
                const manualAnswer = "NEW_MANUAL_ANSWER: volunteers lead public reading sessions.";
                const manual = await newLibraryItem(
                    { companyId, userId: "auth_ada" },
                    { question: QUESTION, answer: manualAnswer }
                );
                const outside = await (await schedule(executor, "bea")).execute();
                expect(outside.run.status).toBe("completed");
                expect(outside.prompt).not.toContain(legacyAnswer);
                expect(outside.prompt).toContain(manualAnswer);
                expect(outside.section.draftMeta?.libraryItemIds).toEqual([manual.id]);
            });
        }
    );

    it.each(SAVED_REQUEST_EVIDENCE)(
        "%s excludes saved answers from a private original request with %s evidence and %s origin",
        async (executor, evidenceKind, originState) => {
            await inIsolatedWorkspace(async () => {
                const publicId = await addDocument("Programme report", PUBLIC_CHUNK);
                const requestSourceId = await addUnindexedPrivateDocument();
                const secretQuestion = `${QUESTION} PRIVATE_REQUEST_QUESTION: explain the acquisition.`;
                const secretAnswer =
                    "PRIVATE_REQUEST_ANSWER: use the confidential acquisition reserve.";
                const manualAnswer =
                    "MANUAL_PUBLIC_ANSWER: community volunteers lead weekly reading.";
                const manual = await newLibraryItem(
                    { companyId, userId: "auth_ada" },
                    { question: QUESTION, answer: manualAnswer, tags: ["programme outcomes"] }
                );
                const origin = await createApplication({
                    companyId,
                    createdByUserId: "auth_ada",
                    title: "Application from a private request",
                    funder: "Community Foundation",
                    opportunityId: null,
                    deadline: null,
                    requestText: secretQuestion,
                    requestUrl: null,
                    requestDocumentId: requestSourceId,
                });
                const [sourceSection] = await replaceSections(companyId, origin.id, [
                    {
                        key: "impact",
                        question: secretQuestion,
                        guidance: null,
                        wordLimit: 300,
                        required: true,
                    },
                ]);
                await updateSection(companyId, sourceSection!.id, {
                    draft: secretAnswer,
                    status: "edited",
                    draftMeta:
                        evidenceKind === "empty"
                            ? null
                            : {
                                  cites: [1],
                                  gaps: [],
                                  libraryItemIds: [],
                                  evidence: [
                                      {
                                          n: 1,
                                          documentId: publicId,
                                          title: "Programme report",
                                          page: 1,
                                          quote: PUBLIC_CHUNK,
                                          url: null,
                                      },
                                  ],
                              },
                });
                const saved = await saveSectionToLibrary(
                    { companyId, userId: "auth_ada" },
                    origin.id,
                    sourceSection!.id,
                    ["programme outcomes"]
                );
                const item = await getLibraryItem(companyId, saved.id);
                expect(item?.sourceApplicationId).toBe(origin.id);
                expect(item?.question).toBe(secretQuestion);
                expect(item?.answer).toBe(secretAnswer);
                expect(item?.evidence.map(e => e.documentId)).toEqual(
                    evidenceKind === "empty" ? [] : [publicId]
                );

                const granted = await (await schedule(executor, "ada")).execute();
                expect(granted.run.status).toBe("completed");
                expect(granted.prompt).toContain(secretQuestion);
                expect(granted.prompt).toContain(secretAnswer);
                expect(granted.section.draftMeta?.libraryItemIds).toContain(saved.id);
                if (originState === "deleted") {
                    await deleteApplication(companyId, origin.id);
                    const orphaned = await getLibraryItem(companyId, saved.id);
                    expect(orphaned?.sourceApplicationId).toBeNull();
                    expect(orphaned?.sourceSectionKey).toBe("impact");
                    const grantedAfterDeletion = await (await schedule(executor, "ada")).execute();
                    expect(grantedAfterDeletion.run.status).toBe("completed");
                    expect(grantedAfterDeletion.prompt).toContain(secretQuestion);
                    expect(grantedAfterDeletion.prompt).toContain(secretAnswer);
                    expect(grantedAfterDeletion.section.draftMeta?.libraryItemIds).toContain(
                        saved.id
                    );
                }

                const outside = await (await schedule(executor, "bea")).execute();
                expect(outside.run.status).toBe("completed");
                expect(outside.prompt).toContain(PUBLIC_CHUNK);
                expect(outside.prompt).toContain(manualAnswer);
                expect(outside.section.draftMeta?.libraryItemIds).toContain(manual.id);
                expect({
                    privateRequestPhrasesSentToModel: [secretQuestion, secretAnswer].filter(
                        phrase => outside.prompt.includes(phrase)
                    ),
                    reusedPrivateOrigin: outside.section.draftMeta?.libraryItemIds.includes(
                        saved.id
                    ),
                }).toEqual({
                    privateRequestPhrasesSentToModel: [],
                    reusedPrivateOrigin: false,
                });
            });
        }
    );

    it.each<ProposalsExecutor>(["inline", "worker"])(
        "%s leaves a running duplicate unchanged when the writer's membership was revoked",
        async executor => {
            const pending = await schedule(executor, "cy");
            await test.db
                .update(proposalRuns)
                .set({ status: "running", startedAt: new Date() })
                .where(
                    and(eq(proposalRuns.id, pending.run.id), eq(proposalRuns.companyId, companyId))
                );
            const active = await getRun(pending.run.id, companyId);
            expect(active?.status).toBe("running");
            const [originalSection] = await listSections(companyId, active!.applicationId!);
            await test.db
                .delete(userCompanyMemberships)
                .where(
                    and(
                        eq(userCompanyMemberships.userId, pk.cy),
                        eq(userCompanyMemberships.companyId, companyId)
                    )
                );
            try {
                const outcome = await pending.execute();
                expect({
                    run: outcome.run,
                    section: outcome.section,
                    retrievals: mockRetrievals.length,
                    modelCalls: mockPrompts.length,
                    debits: mockDebitCredits.mock.calls.length,
                }).toEqual({
                    run: active,
                    section: originalSection,
                    retrievals: 0,
                    modelCalls: 0,
                    debits: 0,
                });
                if (executor === "worker")
                    expect(outcome.schedulerResult).toEqual({
                        status: "running",
                        headline: active?.summary?.headline ?? null,
                    });
            } finally {
                await test.db.insert(userCompanyMemberships).values({
                    userId: pk.cy,
                    companyId,
                    role: "member",
                    status: "active",
                });
            }
        }
    );

    it.each<ProposalsExecutor>(["inline", "worker"])(
        "%s fails visibly without retrieval, model calls or a debit if membership is revoked after queueing",
        async executor => {
            const pending = await schedule(executor, "cy");
            expect(mockPrompts).toHaveLength(0);
            expect(mockRetrievals).toHaveLength(0);
            await test.db
                .delete(userCompanyMemberships)
                .where(
                    and(
                        eq(userCompanyMemberships.userId, pk.cy),
                        eq(userCompanyMemberships.companyId, companyId)
                    )
                );
            try {
                const outcome = await pending.execute();
                expect({
                    status: outcome.run.status,
                    hasVisibleError: !!outcome.run.error,
                    retrievals: mockRetrievals.length,
                    modelCalls: mockPrompts.length,
                    debits: mockDebitCredits.mock.calls.length,
                    sectionStatus: outcome.section.status,
                    evidence: outcome.section.draftMeta?.evidence ?? [],
                }).toEqual({
                    status: "failed",
                    hasVisibleError: true,
                    retrievals: 0,
                    modelCalls: 0,
                    debits: 0,
                    sectionStatus: "empty",
                    evidence: [],
                });
            } finally {
                await test.db.insert(userCompanyMemberships).values({
                    userId: pk.cy,
                    companyId,
                    role: "member",
                    status: "active",
                });
            }
        }
    );
});
