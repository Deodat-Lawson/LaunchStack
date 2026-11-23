import {
    runTopicExploration,
    minimizeExplorationTrace,
    type ExplorationTrace,
} from "~/server/vantage/weekly-review-topic-exploration";
import { createWeeklyReviewAuthority } from "~/server/vantage/weekly-review-authority";
import { canonicalTextHash } from "@launchstack/store/document-digests";
import type { AgentModelPort } from "@launchstack/llm";
import type { TopicManifest } from "~/server/vantage/weekly-review-topic-types";
import { SCOPE_NOTHING } from "~/lib/authz/scope-types";
import { createWeeklyReviewRepository } from "~/server/vantage/weekly-review-repository";
jest.mock("@launchstack/store/crypto", () => ({
    encryptSecret: jest.fn(),
    decryptSecret: jest.fn(),
}));

const secret = "CONFIDENTIAL_SOURCE_MARKER ".repeat(30);
const document = {
    ref: "doc:1@2",
    text: secret,
    title: "PRIVATE_TITLE",
    digest: { headline: "PRIVATE_DIGEST" },
};
it.each(["before excerpt", "before second request"])(
    "fails closed on revocation %s and records the distinct code",
    async boundary => {
        let revoked = false;
        const traces: ExplorationTrace[] = [];
        const port: AgentModelPort = {
            respond: jest.fn(async request => {
                if (request.transcript.some(item => item.role === "tool"))
                    throw Error("revoked evidence dispatched");
                if (boundary === "before excerpt") revoked = true;
                return {
                    text: "PRIVATE_RESPONSE",
                    toolCalls: [
                        {
                            id: "read",
                            name: "read_document_excerpt",
                            arguments: { ref: document.ref, start: 0, end: 300 },
                        },
                    ],
                };
            }),
        };
        await expect(
            runTopicExploration({
                catalogue: {},
                topics: [],
                offered: [document],
                port,
                deadlineAt: Date.now() + 10000,
                authorizeStep: async () => {
                    if (revoked) throw Error("Beta, capability or source revoked");
                },
                record: async trace => {
                    traces.push(trace);
                    if (
                        boundary === "before second request" &&
                        trace.events.some(event => (event as { kind: string }).kind === "tool")
                    )
                        revoked = true;
                },
            })
        ).rejects.toThrow("topic_authority_revoked");
        expect(port.respond).toHaveBeenCalledTimes(1);
        expect(traces.at(-1)?.events.at(-1)).toMatchObject({
            kind: "failure",
            code: "topic_authority_revoked",
        });
        const stored = JSON.stringify(traces);
        for (const text of [
            "CONFIDENTIAL_SOURCE_MARKER",
            "PRIVATE_RESPONSE",
            "PRIVATE_TITLE",
            "PRIVATE_DIGEST",
            document.ref,
        ])
            expect(stored).not.toContain(text);
        if (boundary === "before excerpt")
            expect(
                traces
                    .flatMap(trace => trace.events)
                    .some(event => (event as { kind: string }).kind === "tool")
            ).toBe(false);
        else {
            const event = traces
                .at(-1)
                ?.events.find(event => (event as { kind: string }).kind === "tool");
            expect(event).toMatchObject({
                documentVersionId: "2",
                documentHash: canonicalTextHash(secret),
                ranges: [
                    { start: 0, end: 300, excerptHash: canonicalTextHash(secret.slice(0, 300)) },
                ],
            });
            expect(minimizeExplorationTrace(traces.at(-1))).toEqual(traces.at(-1));
        }
    }
);

it("minimizes untrusted historical trace payloads and is idempotent", () => {
    const trace = minimizeExplorationTrace({
        events: [
            {
                kind: "tool",
                name: "read_document_excerpt",
                args: { ref: secret },
                content: secret,
                resultHash: "a".repeat(64),
                documentVersionId: "9223372036854775807",
                documentHash: "b".repeat(64),
                ranges: [{ start: 10, end: 310, excerptHash: "c".repeat(64), text: secret }],
            },
            { kind: "response", response: { text: secret, toolCalls: [{ arguments: secret }] } },
            { kind: secret, name: secret, code: secret, text: secret },
        ],
    });
    expect(JSON.stringify(trace)).not.toContain("CONFIDENTIAL_SOURCE_MARKER");
    expect(trace.events[0]).toMatchObject({
        kind: "tool",
        name: "read_document_excerpt",
        resultHash: "a".repeat(64),
        documentVersionId: "9223372036854775807",
        documentHash: "b".repeat(64),
        ranges: [{ start: 10, end: 310, excerptHash: "c".repeat(64) }],
    });
    expect(minimizeExplorationTrace(trace)).toEqual(trace);
    for (const invalid of [
        { documentVersionId: secret },
        { documentHash: secret },
        { ranges: [{ start: 0, end: 100, excerptHash: "c".repeat(64) }] },
        { ranges: [{ start: 0, end: 300, excerptHash: secret }] },
    ]) {
        const sanitized = minimizeExplorationTrace({
            events: [{ ...(trace.events[0] as object), ...invalid }],
        });
        expect(sanitized.events[0]).not.toHaveProperty("documentVersionId");
        expect(sanitized.events[0]).not.toHaveProperty("ranges");
        expect(JSON.stringify(sanitized)).not.toContain("CONFIDENTIAL_SOURCE_MARKER");
    }
});

it.each(["beta", "actor", "capability", "epoch", "scope", "restriction", "hash"])(
    "renews %s authority for retained offered parents",
    async revoked => {
        const actor = {
            companyId: "1",
            userId: "owner",
            role: "owner",
            canRead: true,
            canMutate: true,
            documentScope: { kind: "everything" as const },
        };
        const query = jest.fn(async (sql: string) => {
            if (sql.startsWith("SELECT version"))
                return [{ version: revoked === "epoch" ? "8" : "7" }];
            if (sql.startsWith("SELECT d.id")) return [{ id: 1, category: "General" }];
            if (sql.startsWith("SELECT 1 FROM"))
                return revoked === "restriction" ? [{ restricted: 1 }] : [];
            if (sql.startsWith("SELECT encode"))
                return [
                    { content_hash: revoked === "hash" ? "changed" : canonicalTextHash(secret) },
                ];
            return [];
        });
        const authority = createWeeklyReviewAuthority(
            { transaction: work => work(query) },
            async () => {
                if (revoked === "beta") throw Error("Beta disabled");
                return {
                    ...actor,
                    userId: revoked === "actor" ? "another" : actor.userId,
                    canMutate: revoked !== "capability",
                    documentScope: revoked === "scope" ? SCOPE_NOTHING : actor.documentScope,
                };
            }
        );
        await expect(
            authority.assertTopicOffers(query, { ...actor, authorityEpoch: "7" }, {
                epoch: "7",
                cutoff: new Date().toISOString(),
                offered: [{ id: "1", version: "2", hash: canonicalTextHash(secret) }],
            } as TopicManifest)
        ).rejects.toThrow();
    }
);

it("enforces the persistence allowlist and expires both new and historical failed traces", async () => {
    const actor = { companyId: "1", userId: "owner" };
    const queries: { sql: string; args: unknown[] }[] = [];
    const row = { status: "reserved", exploration_dispatched: true, snapshot_hash: null };
    const query = async (sql: string, args: unknown[] = []) => {
        queries.push({ sql, args });
        if (sql.startsWith("SELECT * FROM pdr_ai_v2_vantage_weekly_review_runs")) return [row];
        if (sql.includes("SET status='failed'")) row.status = "failed";
        if (sql.startsWith("SELECT id,week_start,status"))
            return [{ id: "run", week_start: "2026-11-09", status: row.status }];
        return [];
    };
    const repository = createWeeklyReviewRepository(
        { transaction: work => work(query) },
        async () => {}
    );
    await repository.recordExploration(actor, "run", {
        trace: {
            events: [
                {
                    kind: "tool",
                    name: "read_document_excerpt",
                    args: secret,
                    content: secret,
                    documentVersionId: "2",
                    documentHash: canonicalTextHash(secret),
                    ranges: [
                        {
                            start: 0,
                            end: 300,
                            excerptHash: canonicalTextHash(secret.slice(0, 300)),
                            text: secret,
                        },
                    ],
                },
            ],
        },
    });
    expect(JSON.stringify(queries)).not.toContain("CONFIDENTIAL_SOURCE_MARKER");
    const persistedTrace = JSON.parse(String(queries.at(-1)?.args[1]));
    expect(persistedTrace.events[0]).toMatchObject({
        documentVersionId: "2",
        documentHash: canonicalTextHash(secret),
        ranges: [{ start: 0, end: 300, excerptHash: canonicalTextHash(secret.slice(0, 300)) }],
    });
    expect(persistedTrace.events[0].ranges[0]).not.toHaveProperty("text");
    await repository.fail(actor, "run", "topic_authority_revoked");
    expect(queries.at(-1)).toMatchObject({
        sql: expect.stringContaining("SET trace=NULL"),
        args: ["1", "owner"],
    });
    expect(queries.at(-1)?.sql).toContain("r.status='failed'");
    await repository.findByKey(actor, "2026-11-09", "key");
    await repository.list(actor);
    expect(queries.filter(query => query.sql.includes("SET trace=NULL"))).toHaveLength(3);
});
