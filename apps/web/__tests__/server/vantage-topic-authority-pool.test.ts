import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { canonicalTextHash } from "@launchstack/store/document-digests";
import { POST } from "~/app/api/vantage/reviews/route";
import { getEngine } from "~/server/engine";
import {
    documentSettings,
    folderSettings,
    settingsValues,
    userCompanyMemberships,
    users,
    workspaceRoles,
} from "~/server/db/schema";
import { createWeeklyReviewAuthority } from "~/server/vantage/weekly-review-authority";
import { createWeeklyReviewRepository } from "~/server/vantage/weekly-review-repository";
import {
    generateWeeklyReview,
    weeklyReviewDatabase,
    weeklyReviewServices,
} from "~/server/vantage/weekly-review-service";

type AuthorityModule = { createWeeklyReviewAuthority: typeof createWeeklyReviewAuthority };

jest.mock("~/server/engine", () => ({ getEngine: jest.fn() }));
jest.mock("~/server/auth", () => ({
    getServerSession: async () => ({ user: { id: "owner" } }),
}));
jest.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
jest.mock("~/lib/models", () => ({ resolveConfiguredChatModel: jest.fn() }));
jest.mock("~/server/workspace-models/scope", () => ({
    withWorkspaceChatModels: (_company: unknown, _scope: unknown, work: () => unknown) => work(),
}));
jest.mock("~/server/vantage/weekly-review-test-provider", () => ({
    weeklyReviewTestPorts: () => ({}),
}));
jest.mock("~/server/vantage/weekly-review-authority", () => {
    const actual = jest.requireActual<AuthorityModule>("~/server/vantage/weekly-review-authority");
    return { ...actual, createWeeklyReviewAuthority: jest.fn(actual.createWeeklyReviewAuthority) };
});
jest.mock("~/server/vantage/weekly-review-repository", () => ({
    createWeeklyReviewRepository: jest.fn(),
}));
jest.mock("@launchstack/pipelines/vantage", () =>
    jest.requireActual("../../../../pipelines/src/vantage/week")
);

const actor = { companyId: "1", userId: "owner", authorityEpoch: "7" };
const versions = ["31", "32", "33", "34"];
const content = "A synthetic decision covering the entire test document.";
const hash = canonicalTextHash(content);
const manifest = {
    epoch: actor.authorityEpoch,
    cutoff: "2026-11-16T00:00:00.000Z",
    configuration: { provider: "scripted" },
    offered: versions.map(version => ({ id: version, version, hash })),
    fixedDependencies: [
        {
            kind: "document",
            id: "100",
            version: "101",
            hash,
            purpose: "company-architecture",
        },
    ],
};

/** The shared engine pool owns a transaction lease until its callback settles. */
function installPool(max: number) {
    const fixture = {
        betaEnabled: true,
        canMutate: true,
        epoch: actor.authorityEpoch,
        fixedContent: content,
    };
    const dialect = new PgDialect();
    const waiters: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
    const tables: Record<string, () => unknown[]> = {
        [getTableName(users)]: () => [{ id: 10, companyId: 1 }],
        [getTableName(userCompanyMemberships)]: () => [
            { companyId: 1n, role: "custom-owner", status: "active" },
        ],
        [getTableName(workspaceRoles)]: () => [
            {
                name: "Custom owner",
                permissions: fixture.canMutate
                    ? ["documents.read", "documents.edit"]
                    : ["documents.read"],
            },
        ],
        [getTableName(settingsValues)]: () => [{ value: fixture.betaEnabled }],
    };
    let active = 0;
    let locked = 0;
    let peakLocked = 0;
    let closed = false;
    const closeError = new Error("test pool closed");
    async function lease<T>(work: () => Promise<T>): Promise<T> {
        if (closed) throw closeError;
        if (active >= max) {
            await new Promise<void>((resolve, reject) => waiters.push({ resolve, reject }));
        } else {
            active++;
        }
        try {
            return await work();
        } finally {
            const next = waiters.shift();
            if (next) next.resolve();
            else active--;
        }
    }
    const readsUnderEpoch: string[] = [];
    function executor(transaction?: { locked: boolean }) {
        return {
            select: () => ({
                from(table: Table) {
                    const name = getTableName(table);
                    const read = async () => {
                        if (transaction?.locked) readsUnderEpoch.push(name);
                        return tables[name]?.() ?? [];
                    };
                    const query = {
                        where: () => query,
                        orderBy: () => query,
                        innerJoin: () => query,
                        limit: () => query,
                        then: (
                            resolve: (rows: unknown[]) => unknown,
                            reject: (error: unknown) => unknown
                        ) => (transaction ? read() : lease(read)).then(resolve, reject),
                    };
                    return query;
                },
            }),
            async execute(sql: SQL) {
                const { sql: statement, params } = dialect.sqlToQuery(sql);
                if (statement.includes("FOR SHARE")) {
                    if (!transaction!.locked) {
                        transaction!.locked = true;
                        peakLocked = Math.max(peakLocked, ++locked);
                    }
                    return [{ version: fixture.epoch }];
                }
                if (statement.includes("FROM pdr_ai_v2_document_version_digests"))
                    return [{ id: params[2], headline: content, items: [] }];
                if (statement.includes("AS content_hash")) return [{ content_hash: hash }];
                if (statement.includes("LEFT JOIN LATERAL"))
                    return [
                        {
                            id: params.at(-1),
                            category: "Shared",
                            title: content,
                            version_id: params[0],
                        },
                    ];
                if (statement.includes("AS chunk_count"))
                    return [
                        {
                            chunk_count: 1,
                            text_bytes: Buffer.byteLength(fixture.fixedContent),
                            text_chars: fixture.fixedContent.length,
                        },
                    ];
                if (statement.startsWith("SELECT content FROM pdr_ai_v2_document_context_chunks"))
                    return [{ content: fixture.fixedContent }];
                if (statement.startsWith("SELECT d.id,d.category"))
                    return [{ id: params[0], title: content, category: "Shared" }];
                return [];
            },
        };
    }
    const db = {
        ...executor(),
        transaction: <T>(work: (tx: ReturnType<typeof executor>) => Promise<T>) =>
            lease(async () => {
                const transaction = { locked: false };
                try {
                    return await work(executor(transaction));
                } finally {
                    if (transaction.locked) locked--;
                }
            }),
    };
    jest.mocked(getEngine).mockReturnValue({
        db,
        dbHandle: { client: { options: { max } } },
        config: { db: { maxConnections: max } },
    } as never);
    return {
        fixture,
        readsUnderEpoch,
        state: () => ({ active, locked, peakLocked, waiting: waiters.length }),
        close: () => {
            closed = true;
            for (const waiter of waiters.splice(0)) waiter.reject(closeError);
        },
    };
}

async function within<T>(work: Promise<T>, pool: ReturnType<typeof installPool>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            work,
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error(`Engine pool stalled: ${JSON.stringify(pool.state())}`)),
                    750
                );
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
        pool.close();
    }
}

it.each(["service", "HTTP"] as const)(
    "completes two simultaneous %s starts and leaves a lease for other work in a two-slot pool",
    async entryPoint => {
        const pool = installPool(2);
        const env = jest.replaceProperty(process, "env", {
            ...process.env,
            VANTAGE_WEEKLY_REVIEW_ENABLED: "true",
            VANTAGE_TOPIC_FIRST_PROVIDER: "scripted",
        });
        const createAuthority = jest.requireActual<AuthorityModule>(
            "~/server/vantage/weekly-review-authority"
        ).createWeeklyReviewAuthority;
        const stopAfterDigest = new Error("test stop after digest preparation");
        jest.mocked(createWeeklyReviewAuthority).mockImplementation((...args) => ({
            ...createAuthority(...args),
            collectWeeklyReviewContext: async () =>
                ({
                    role: "custom-owner",
                    authorityEpoch: actor.authorityEpoch,
                    mandatoryCoverage: { required: 0, included: 0 },
                    sources: [],
                    topicSeed: {
                        manifest: { ...manifest },
                        documents: versions.map(version => ({ version })),
                    },
                }) as never,
        }));
        const recordDigestPreparation = jest.fn();
        jest.mocked(createWeeklyReviewRepository).mockReturnValue({
            findByKey: async () => null,
            reserveTopic: async (_actor: unknown, key: string) => ({ created: true, id: key }),
            beginDigestPreparation: async () => {},
            recordDigestPreparation,
            claimExploration: async () => {
                throw stopAfterDigest;
            },
            fail: async () => {},
        } as never);
        const log = jest.spyOn(console, "error").mockImplementation(() => {});
        try {
            const args = { weekStart: "2026-11-09", expectedActiveId: null };
            if (entryPoint === "HTTP") {
                const work = ["application/json", "application/x-ndjson"].map(
                    async (accept, index) => {
                        const response = await POST(
                            new Request("http://localhost/api/vantage/reviews", {
                                method: "POST",
                                headers: {
                                    Accept: accept,
                                    "Content-Type": "application/json",
                                    "Idempotency-Key": `run-${index}-fixture`,
                                },
                                body: JSON.stringify(args),
                            })
                        );
                        return { status: response.status, body: await response.text() };
                    }
                );
                const [json, stream] = await within(Promise.all(work), pool);
                expect(json).toEqual({
                    status: 409,
                    body: '{"error":"candidate_not_admitted"}',
                });
                expect(stream).toEqual({
                    status: 200,
                    body: expect.stringContaining('"error":"candidate_not_admitted"'),
                });
            } else {
                const work = ["run-one", "run-two"].map(key =>
                    generateWeeklyReview(actor, { ...args, key })
                );
                const results = await within(Promise.allSettled(work), pool);
                expect(results).toEqual([
                    {
                        status: "rejected",
                        reason: expect.objectContaining({ code: "candidate_not_admitted" }),
                    },
                    {
                        status: "rejected",
                        reason: expect.objectContaining({ code: "candidate_not_admitted" }),
                    },
                ]);
            }
            expect(recordDigestPreparation.mock.calls).toHaveLength(2);
            for (const [, , result] of recordDigestPreparation.mock.calls)
                expect(result).toMatchObject({
                    digestIds: versions,
                    timing: { digestOutcome: "ready" },
                });
            expect(pool.state()).toMatchObject({ active: 0, locked: 0, peakLocked: 1, waiting: 0 });
            expect(pool.readsUnderEpoch).toEqual(
                expect.arrayContaining(
                    [
                        users,
                        userCompanyMemberships,
                        workspaceRoles,
                        settingsValues,
                        folderSettings,
                        documentSettings,
                    ].map(getTableName)
                )
            );
        } finally {
            jest.mocked(createWeeklyReviewAuthority).mockImplementation(createAuthority);
            log.mockRestore();
            env.restore();
        }
    }
);

it("checks fresh Beta, role capabilities and the pinned epoch even with only one engine lease", async () => {
    const pool = installPool(1);
    const check = () => {
        const { authority } = weeklyReviewServices();
        return weeklyReviewDatabase.transaction(query =>
            authority.assertTopicStep(query, actor, manifest as never, "digest")
        );
    };
    await within(
        (async () => {
            await expect(check()).resolves.toBeUndefined();
            pool.fixture.betaEnabled = false;
            await expect(check()).rejects.toMatchObject({ code: "topic_authority_revoked" });
            pool.fixture.betaEnabled = true;
            pool.fixture.canMutate = false;
            await expect(check()).rejects.toMatchObject({ code: "topic_authority_revoked" });
            pool.fixture.canMutate = true;
            pool.fixture.fixedContent = "Changed exact frozen content";
            await expect(check()).rejects.toMatchObject({ code: "topic_authority_revoked" });
            pool.fixture.fixedContent = content;
            pool.fixture.epoch = "8";
            await expect(check()).rejects.toMatchObject({ code: "topic_authority_revoked" });
        })(),
        pool
    );
});
