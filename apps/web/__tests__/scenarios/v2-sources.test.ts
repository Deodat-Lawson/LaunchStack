/**
 * The v2 source collector reads the run's sources as its creator may (ADR-014)
 * and keeps a locator for every quote: document, version, chunk, page and
 * heading path from the chunk store. What it does not read — a file the
 * creator can't open, one still processing, one with no text, sections over
 * the per-document budget, Growth sources while beta apps are off — is
 * recorded as an omission, never dropped silently.
 */
import type { ScenarioRunRecord } from "@launchstack/pipelines/scenarios";
import {
    DEFAULT_SOURCE_BUDGET,
    V2_VERSIONS,
    type RequestSpecV2,
} from "@launchstack/pipelines/scenarios/v2";

import { SCOPE_EVERYTHING } from "~/lib/authz/scope-types";

jest.mock("~/lib/require-workspace-context", () => ({ resolveMemberContext: jest.fn() }));
jest.mock("@launchstack/retrieval/algorithms/bm25", () => ({ getMultiDocChunks: jest.fn() }));
jest.mock("@launchstack/tools/grounded-retrieval", () => ({ retrieveCompanySnippets: jest.fn() }));
jest.mock("@launchstack/pipelines/distribution/db", () => ({ listPartners: jest.fn() }));
jest.mock("~/server/beta-apps", () => ({ betaAppsOn: jest.fn() }));

/**
 * A drizzle-shaped fake: `select(fields).from(table)` resolves to what the
 * table's responder returns for those fields (joins, filters and ordering
 * are the real query's job; the responder returns the rows it would).
 */
jest.mock("~/server/db", () => {
    const responders = new Map<unknown, (mockFields: Record<string, unknown>) => unknown[]>();
    const chain = (rows: () => unknown[]) => {
        const c: Record<string, unknown> = {};
        for (const m of ["where", "orderBy", "limit", "innerJoin", "leftJoin"]) c[m] = () => c;
        c.then = (
            resolve: (mockValue: unknown) => unknown,
            reject: (mockError: unknown) => unknown
        ) => {
            try {
                return resolve(rows());
            } catch (error) {
                return reject(error);
            }
        };
        return c;
    };
    return {
        db: {
            select: (fields: Record<string, unknown> = {}) => ({
                from: (table: unknown) => chain(() => responders.get(table)?.(fields) ?? []),
            }),
        },
        __respond: (table: unknown, fn: (mockFields: Record<string, unknown>) => unknown[]) =>
            responders.set(table, fn),
        __reset: () => responders.clear(),
    };
});

import { document, documentSections, ocrJobs } from "@launchstack/store/schema";

import { brandComments, companyMetadata } from "~/server/db/schema";
import { ScenarioCreatorGoneError } from "~/server/scenarios/evidence";
import {
    collectScenarioSources,
    headingPath,
    pickDocumentSections,
    type ChunkRow,
} from "~/server/scenarios/v2/sources";

const fakeDb = jest.requireMock<{
    __respond: (t: unknown, fn: (fields: Record<string, unknown>) => unknown[]) => void;
    __reset: () => void;
}>("~/server/db");
const { resolveMemberContext } = jest.requireMock<{ resolveMemberContext: jest.Mock }>(
    "~/lib/require-workspace-context"
);
const { retrieveCompanySnippets } = jest.requireMock<{ retrieveCompanySnippets: jest.Mock }>(
    "@launchstack/tools/grounded-retrieval"
);
const { listPartners } = jest.requireMock<{ listPartners: jest.Mock }>(
    "@launchstack/pipelines/distribution/db"
);
const { betaAppsOn } = jest.requireMock<{ betaAppsOn: jest.Mock }>("~/server/beta-apps");

const SUBJECT = "Acme moves Northwind off Acme Legacy; the migration takes two weeks.";

function spec(
    sources: Partial<RequestSpecV2["sources"]>,
    perDocumentTokens = 4_000
): RequestSpecV2 {
    return {
        contractVersion: 2,
        kind: "scenario",
        title: "t",
        subject: SUBJECT,
        agents: 4,
        rounds: 2,
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
        contextMode: "passage",
        requestedContextMode: "passage",
        fallbackReason: null,
        budget: { maxCredits: 1, repairsPerUnit: 1 },
        policies: {
            versions: V2_VERSIONS,
            actorTokenCap: 1_200,
            sourceBudget: { ...DEFAULT_SOURCE_BUDGET, perDocumentTokens },
            castBatchSize: 10,
            ingestBatchSize: 6,
        },
    };
}

const run = { id: 1, companyId: 5n, createdByUserId: "creator" } as ScenarioRunRecord;

/** Files 7 (contacts.pdf v3) and 8 (renewal.pdf v5) are visible; 9 is not. */
function files(
    chunks: Array<Partial<ChunkRow> & { documentId: number; content: string }>,
    docs = [
        { id: 7, title: "contacts.pdf", currentVersionId: 3n },
        { id: 8, title: "renewal.pdf", currentVersionId: 5n },
    ]
) {
    fakeDb.__respond(document, fields =>
        Object.keys(fields).length === 1 ? docs.map(d => ({ id: d.id })) : docs.map(d => ({ ...d }))
    );
    fakeDb.__respond(documentSections, () =>
        chunks.map((c, i) => ({
            id: c.id ?? 100 + i,
            documentId: BigInt(c.documentId),
            versionId: c.versionId === undefined ? BigInt(c.documentId === 7 ? 3 : 5) : c.versionId,
            content: c.content,
            page: c.page ?? null,
            heading: c.heading ?? null,
            path: c.path ?? null,
            level: c.level ?? null,
        }))
    );
}

function fact(value: string, docId: number, extra: Record<string, unknown> = {}) {
    return {
        value,
        visibility: "internal",
        usage: "general",
        confidence: 0.9,
        priority: "normal",
        status: "active",
        last_updated: "2026-11-01T00:00:00Z",
        sources: [
            {
                doc_id: docId,
                doc_name: docId === 9 ? "board-minutes.pdf" : "renewal.pdf",
                extracted_at: "2026-11-01T00:00:00Z",
                page: 4,
                quote: docId === 9 ? "Board-only budget line." : "Northwind uses Acme Legacy.",
                version_id: 5,
            },
        ],
        ...extra,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    fakeDb.__reset();
    resolveMemberContext.mockResolvedValue({ documentScope: async () => SCOPE_EVERYTHING });
    betaAppsOn.mockResolvedValue(true);
    retrieveCompanySnippets.mockResolvedValue({ snippets: [], results: [] });
    listPartners.mockResolvedValue([]);
});

describe("picked files", () => {
    it("locates every quote: document, version, chunk, page and heading path", async () => {
        files([
            {
                documentId: 7,
                id: 41,
                page: 2,
                content: "Maya recommends Northwind's software purchases; Lee approves them.",
            },
            {
                documentId: 8,
                id: 52,
                page: 4,
                level: 2,
                path: "/Renewal terms/Migration",
                heading: "Migration",
                content:
                    "Northwind uses Acme Legacy. Migration requires approximately fourteen days.",
            },
        ]);
        const { sections, omissions } = await collectScenarioSources(
            run,
            spec({ documentIds: [7, 8, 9] })
        );
        expect(omissions).toEqual([
            {
                sourceType: "document",
                sourceId: "9",
                label: "A file you can't open",
                reason: "no_access",
                tokens: null,
            },
        ]);
        const renewal = sections.find(s => s.sourceId === "8")!;
        expect(renewal).toMatchObject({
            kind: "document",
            sourceType: "document",
            versionId: "5",
            label: "renewal.pdf, page 4",
            locator: {
                documentId: 8,
                versionId: 5,
                chunkId: 52,
                page: 4,
                section: "Renewal terms › Migration",
                providerId: null,
            },
            validity: "versioned",
            documentIds: [8],
            href: "/employer/documents?docId=8",
            fact: null,
        });
        const contacts = sections.find(s => s.sourceId === "7")!;
        expect(contacts.locator).toMatchObject({
            documentId: 7,
            versionId: 3,
            chunkId: 41,
            page: 2,
        });
        // No structure node (or only the root): no heading claimed.
        expect(contacts.locator.section).toBeNull();
        expect(renewal.score).toBeGreaterThan(0);
    });

    it("keeps the best sections and their neighbours under the per-document budget, and records the rest", async () => {
        const filler = "Unrelated facilities detail about parking and lunch. ".repeat(6); // ~80 tokens
        files(
            [
                ...Array.from({ length: 10 }, (_, i) => ({
                    documentId: 8,
                    id: 200 + i,
                    page: i + 1,
                    content:
                        i === 6
                            ? "The Acme Legacy migration for Northwind takes two weeks."
                            : filler,
                })),
            ],
            [{ id: 8, title: "renewal.pdf", currentVersionId: 5n }]
        );
        const { sections, omissions } = await collectScenarioSources(
            run,
            spec({ documentIds: [8] }, 200)
        );
        // The matching page 7 first, then its neighbours (pages 6 and 8).
        expect(sections.map(s => s.locator.page)).toEqual([7, 6, 8]);
        expect(sections[0]!.score).toBeGreaterThan(sections[1]!.score);
        expect(omissions).toEqual([
            {
                sourceType: "document",
                sourceId: "8",
                label: "renewal.pdf",
                reason: "budget",
                tokens: expect.any(Number) as number,
            },
        ]);
        expect(omissions[0]!.tokens).toBeGreaterThan(400);
    });

    it("tells a file still processing from one with no text", async () => {
        files(
            [],
            [
                { id: 7, title: "contacts.pdf", currentVersionId: 3n },
                { id: 8, title: "renewal.pdf", currentVersionId: 5n },
            ]
        );
        fakeDb.__respond(ocrJobs, () => [
            { documentId: 7n, versionId: 3n, status: "processing" },
            { documentId: 8n, versionId: 5n, status: "completed" },
        ]);
        const { sections, omissions } = await collectScenarioSources(
            run,
            spec({ documentIds: [7, 8] })
        );
        expect(sections).toEqual([]);
        expect(omissions.map(o => [o.sourceId, o.label, o.reason])).toEqual([
            ["7", "contacts.pdf", "not_ready"],
            ["8", "renewal.pdf", "empty"],
        ]);
    });
});

describe("company facts", () => {
    beforeEach(() => {
        files([{ documentId: 8, page: 4, content: "Northwind uses Acme Legacy." }]);
        fakeDb.__respond(companyMetadata, () => [
            {
                metadata: {
                    people: [
                        {
                            name: fact("Northwind operations", 8),
                            role: fact("Runs Acme Legacy", 8),
                        },
                        { name: fact("Board member", 9), role: fact("Signs the budget", 9) },
                    ],
                    services: [{ name: fact("Acme Cloud migration", 7) }],
                },
            },
        ]);
    });

    it("keeps facts read from the picked files as typed items the creator can see", async () => {
        const { sections } = await collectScenarioSources(run, spec({ documentIds: [8] }));
        const facts = sections.filter(s => s.fact);
        expect(facts.map(f => [f.sourceType, f.fact!.key])).toEqual([
            ["company_fact", "people[0]"],
        ]);
        expect(facts[0]).toMatchObject({
            kind: "company_profile",
            label: "Company profile: Northwind operations",
            fact: {
                key: "people[0]",
                label: "Northwind operations",
                value: "role: Runs Acme Legacy",
                sourceDocumentIds: [8],
            },
            locator: { documentId: 8, versionId: 5, page: 4 },
            validity: "unknown",
            documentIds: [8],
        });
        expect(facts[0]!.text).toContain("renewal.pdf");
    });

    it("adds the profile's matching facts when asked, never one from a file the creator can't open", async () => {
        const { sections } = await collectScenarioSources(
            run,
            spec({ documentIds: [8], companyProfile: true })
        );
        const keys = sections.filter(s => s.fact).map(s => [s.sourceType, s.fact!.key]);
        expect(keys).toContainEqual(["company_fact", "people[0]"]);
        expect(keys).toContainEqual(["company_profile", "services[0]"]);
        expect(keys.map(k => k[1])).not.toContain("people[1]");
        expect(sections.map(s => s.text).join(" ")).not.toContain("board-minutes");
    });
});

describe("other sources", () => {
    it("reads Growth sources only while beta apps are on, and says so when they are off", async () => {
        betaAppsOn.mockResolvedValue(false);
        const off = await collectScenarioSources(
            run,
            spec({ prospects: true, brandComments: true })
        );
        expect(off.sections).toEqual([]);
        expect(off.omissions.map(o => [o.sourceType, o.reason])).toEqual([
            ["prospect", "no_access"],
            ["brand_comment", "no_access"],
        ]);
        expect(listPartners).not.toHaveBeenCalled();

        betaAppsOn.mockResolvedValue(true);
        listPartners.mockResolvedValue([
            {
                org: {
                    id: "org1",
                    name: "Contoso",
                    categories: ["logistics"],
                    sizeBand: "50-200",
                    description: "Runs depots.",
                },
                relationship: { fitScore: 0.8, fitRationale: "Uses Acme Legacy.", stage: "lead" },
            },
        ]);
        fakeDb.__respond(brandComments, () => [
            { id: "c1", platform: "linkedin", body: "Two weeks of migration is too long." },
        ]);
        const on = await collectScenarioSources(
            run,
            spec({ prospects: true, brandComments: true })
        );
        expect(on.sections.map(s => [s.sourceType, s.sourceId, s.validity, s.versionId])).toEqual([
            ["prospect", "org1", "unknown", null],
            ["brand_comment", "c1", "unknown", null],
        ]);
        expect(on.sections[1]!.label).toBe("Comment on your linkedin post");
    });

    it("anchors search hits to their version and section, drops ones out of scope and ones already picked", async () => {
        files([{ documentId: 8, id: 52, page: 4, content: "Northwind uses Acme Legacy." }]);
        retrieveCompanySnippets.mockResolvedValue({
            snippets: [],
            results: [
                {
                    pageContent: "Northwind uses Acme Legacy.",
                    metadata: { documentId: 8, parentChunkId: 52, versionId: 5, page: 4 },
                },
                {
                    pageContent: "Acme Cloud pricing starts in March.",
                    metadata: {
                        documentId: 7,
                        documentTitle: "pricing.pdf",
                        chunkId: 61,
                        versionId: 3,
                        page: 1,
                    },
                },
                {
                    pageContent: "Board-only margin plan.",
                    metadata: { documentId: 9, documentTitle: "Board memo", page: 2 },
                },
            ],
        });
        const { sections } = await collectScenarioSources(
            run,
            spec({ documentIds: [8], searchFiles: true })
        );
        const search = sections.filter(s => s.sourceType === "search");
        expect(search).toEqual([
            expect.objectContaining({
                kind: "search",
                sourceId: "7",
                versionId: "3",
                label: "pricing.pdf, page 1",
                locator: {
                    documentId: 7,
                    versionId: 3,
                    chunkId: 61,
                    page: 1,
                    section: null,
                    providerId: null,
                },
                validity: "versioned",
            }),
        ]);
        expect(retrieveCompanySnippets).toHaveBeenCalledWith(
            expect.objectContaining({ scope: SCOPE_EVERYTHING, query: SUBJECT })
        );
    });

    it("records a source that fails instead of failing the run", async () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        retrieveCompanySnippets.mockRejectedValue(new Error("embeddings down"));
        const { sections, omissions } = await collectScenarioSources(
            run,
            spec({ searchFiles: true, notes: "First para.\n\nSecond para." })
        );
        expect(omissions).toEqual([
            {
                sourceType: "search",
                sourceId: "search",
                label: "File search",
                reason: "not_ready",
                tokens: null,
            },
        ]);
        expect(sections.map(s => [s.sourceType, s.validity, s.text])).toEqual([
            ["notes", "unknown", "First para.\nSecond para."],
        ]);
        warn.mockRestore();
    });

    it("stops when the creator is no longer an active member", async () => {
        resolveMemberContext.mockResolvedValue(null);
        await expect(collectScenarioSources(run, spec({ notes: "x" }))).rejects.toBeInstanceOf(
            ScenarioCreatorGoneError
        );
    });
});

describe("section picking", () => {
    const chunk = (i: number, content: string): ChunkRow => ({
        id: i,
        documentId: 1,
        versionId: 1,
        content,
        page: i,
        heading: null,
        path: null,
        level: null,
    });

    it("takes a whole small document", () => {
        const { kept, leftOut } = pickDocumentSections(
            [chunk(1, "Intro."), chunk(2, "Migration takes two weeks."), chunk(3, "Contacts.")],
            new Set(["migration", "weeks"]),
            4_000
        );
        expect(kept.map(k => k.chunk.id)).toEqual([2, 1, 3]);
        expect(leftOut).toBe(0);
    });

    it("cuts a section longer than the section limit at a sentence and counts the cut", () => {
        const long = `${"A sentence about migration. ".repeat(400)}`;
        const { kept, leftOut } = pickDocumentSections(
            [chunk(1, long)],
            new Set(["migration"]),
            4_000,
            100
        );
        expect(kept[0]!.text.length).toBeLessThanOrEqual(400);
        expect(kept[0]!.text.endsWith(".")).toBe(true);
        expect(leftOut).toBeGreaterThan(2_000);
    });

    it("reads heading paths from the structure tree, not its root", () => {
        expect(headingPath({ heading: "Document Root", path: "/", level: 0 })).toBeNull();
        expect(headingPath({ heading: "Pricing", path: "/Plans/Pricing", level: 2 })).toBe(
            "Plans › Pricing"
        );
        expect(headingPath({ heading: "Pricing", path: null, level: 1 })).toBe("Pricing");
        expect(headingPath({ heading: null, path: null, level: null })).toBeNull();
    });
});
