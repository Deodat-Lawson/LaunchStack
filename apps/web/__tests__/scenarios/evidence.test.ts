/**
 * Evidence is gathered as the run's creator may see it (ADR-014): a picked
 * file or a search hit outside their scope never becomes evidence, comments
 * keep their text but not their author, and a creator who has left stops the
 * run instead of reading with someone else's rights.
 */
import type { ScenarioRunRecord } from "@launchstack/pipelines/scenarios";

import { SCOPE_EVERYTHING } from "~/lib/authz/scope-types";

jest.mock("~/lib/require-workspace-context", () => ({ resolveMemberContext: jest.fn() }));
jest.mock("@launchstack/retrieval/algorithms/bm25", () => ({ getMultiDocChunks: jest.fn() }));
jest.mock("@launchstack/tools/grounded-retrieval", () => ({ retrieveCompanySnippets: jest.fn() }));
jest.mock("@launchstack/pipelines/distribution/db", () => ({ listPartners: jest.fn() }));

/** A drizzle-shaped fake: each `from(table)` resolves to the rows queued for that table. */
jest.mock("~/server/db", () => {
    const queues = new Map<unknown, unknown[][]>();
    const chain = (rows: unknown[]) => {
        const c: Record<string, unknown> = {};
        for (const m of ["where", "orderBy", "limit"]) c[m] = () => c;
        c.then = (resolve: (v: unknown) => unknown) => resolve(rows);
        return c;
    };
    return {
        db: {
            select: () => ({ from: (table: unknown) => chain(queues.get(table)?.shift() ?? []) }),
        },
        __queue: (table: unknown, rows: unknown[]) =>
            queues.set(table, [...(queues.get(table) ?? []), rows]),
    };
});

import { document } from "@launchstack/store/schema";

import { brandComments } from "~/server/db/schema";
import {
    bounded,
    gatherScenarioEvidence,
    ScenarioCreatorGoneError,
} from "~/server/scenarios/evidence";

const { __queue: queue } = jest.requireMock<{ __queue: (t: unknown, rows: unknown[]) => void }>(
    "~/server/db"
);
const { resolveMemberContext } = jest.requireMock<{ resolveMemberContext: jest.Mock }>(
    "~/lib/require-workspace-context"
);
const { getMultiDocChunks } = jest.requireMock<{ getMultiDocChunks: jest.Mock }>(
    "@launchstack/retrieval/algorithms/bm25"
);
const { retrieveCompanySnippets } = jest.requireMock<{ retrieveCompanySnippets: jest.Mock }>(
    "@launchstack/tools/grounded-retrieval"
);

function run(sources: Partial<ScenarioRunRecord["sources"]>): ScenarioRunRecord {
    return {
        id: 1,
        companyId: 5n,
        createdByUserId: "creator",
        kind: "scenario",
        title: "t",
        subject: "pricing churn",
        status: "queued",
        step: 0,
        agentCount: 5,
        roundCount: 1,
        seed: 1,
        sources: {
            documentIds: [],
            searchFiles: false,
            prospects: false,
            brandComments: false,
            companyProfile: false,
            notes: "",
            ...sources,
        },
        evidence: null,
        brief: null,
        world: null,
        report: null,
        reception: null,
        estimate: { calls: 1, inputTokens: 1, outputTokens: 1, credits: 2 },
        usage: { calls: 0, inputTokens: 0, outputTokens: 0, credits: 0 },
        draft: null,
        draftHash: null,
        error: null,
        sharedAt: null,
        cancelRequestedAt: null,
        leaseUntil: null,
        createdAt: new Date(),
        startedAt: null,
        finishedAt: null,
        eventsClosedAt: null,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    resolveMemberContext.mockResolvedValue({ documentScope: async () => SCOPE_EVERYTHING });
});

it("reads only picked files the creator can open", async () => {
    queue(document, [{ id: 7 }]); // the scoped query: 8 is filtered out
    getMultiDocChunks.mockResolvedValue([
        {
            documentId: 7n,
            documentTitle: "Interviews.pdf",
            page: 2,
            content: "Churn is mostly about pricing.",
        },
    ]);
    const evidence = await gatherScenarioEvidence(run({ documentIds: [7, 8] }));
    expect(getMultiDocChunks).toHaveBeenCalledWith([7]);
    expect(evidence).toEqual([
        expect.objectContaining({
            id: "E1",
            kind: "document",
            label: "Interviews.pdf, page 2",
            documentIds: [7],
            href: "/employer/documents?docId=7",
        }),
    ]);
});

it("drops search hits outside the creator's scope even if retrieval returned them", async () => {
    retrieveCompanySnippets.mockResolvedValue({
        snippets: [],
        results: [
            {
                pageContent: "Visible note on pricing.",
                metadata: { documentId: 7, documentTitle: "Notes" },
            },
            {
                pageContent: "Board-only margin plan.",
                metadata: { documentId: 9, documentTitle: "Board memo" },
            },
        ],
    });
    queue(document, [{ id: 7 }]);
    const evidence = await gatherScenarioEvidence(run({ searchFiles: true }));
    expect(retrieveCompanySnippets).toHaveBeenCalledWith(
        expect.objectContaining({ scope: SCOPE_EVERYTHING, query: "pricing churn" })
    );
    expect(evidence.map(e => e.text)).toEqual(["Visible note on pricing."]);
});

it("keeps comment text but never the commenter's name, and splits pasted notes", async () => {
    queue(brandComments, [{ id: "c1", platform: "linkedin", body: "Renewal emails annoy me." }]);
    const evidence = await gatherScenarioEvidence(
        run({ brandComments: true, notes: "First para.\n\nSecond para." })
    );
    expect(evidence.map(e => [e.kind, e.label, e.text])).toEqual([
        ["notes", "Pasted material", "First para. Second para."],
        ["brand_comment", "Comment on your linkedin post", "Renewal emails annoy me."],
    ]);
});

it("stops when the creator is no longer an active member", async () => {
    resolveMemberContext.mockResolvedValue(null);
    await expect(gatherScenarioEvidence(run({ notes: "x" }))).rejects.toBeInstanceOf(
        ScenarioCreatorGoneError
    );
});

it("goes on without a source that fails or takes too long", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(bounded("search", Promise.reject(new Error("embeddings down")))).resolves.toEqual(
        []
    );
    await expect(bounded("search", new Promise<string[]>(() => undefined), 10)).resolves.toEqual(
        []
    );
    await expect(bounded("search", Promise.resolve(["ok"]))).resolves.toEqual(["ok"]);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
});
