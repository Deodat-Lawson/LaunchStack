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
    getRun,
    listSections,
    replaceSections,
    updateSection,
} from "@launchstack/pipelines/proposals/db";
import type { ProposalRunEventData } from "@launchstack/pipelines/proposals";
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
        mockPrompts.push(messages.map(message => String(message.content)).join("\n"));
        if (options.name === "application_review")
            return schema.parse({ summary: "The public draft is ready for review.", findings: [] });
        return schema.parse({
            draft: "Our reading programme supports learners in the community.",
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

    function fact(value: string, documentId: number): MetadataFact {
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
                    quote: documentId === publicDocumentId ? PUBLIC_CHUNK : RESTRICTED_CHUNK,
                },
            ],
        };
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
        kind: "draft" | "rewrite" | "review" = "draft"
    ) {
        process.env.PROPOSALS_EXECUTOR = executor;
        const application = await createApplication({
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
            sectionId: section!.id,
            async execute() {
                mockPrompts.length = 0;
                mockRetrievals.length = 0;
                if (callback) await callback();
                else {
                    const data = { ...event!, userId: `auth_${eventActor}` };
                    try {
                        await job.handler({
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
