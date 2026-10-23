import { describe, expect, it } from "vitest";

import type {
    DiscoveredKnowledgeItem,
    KnowledgeItem,
    KnowledgeSink,
    StoredKnowledgeItem,
} from "../types";
import {
    createNotionClient,
    NotionAuthError,
    NotionNotFoundError,
    type NotionClient,
    type NotionPage,
    type NotionPageMarkdown,
    type NotionSearchPage,
} from "./client";
import { mergeUnknownSubtrees, pageTitle, propertyText, renderPage } from "./render";
import { syncNotion } from "./sync";

function page(input: {
    id: string;
    title: string;
    edited?: string;
    trashed?: boolean;
    parent?: NotionPage["parent"];
    properties?: NotionPage["properties"];
}): NotionPage {
    return {
        object: "page",
        id: input.id,
        url: `https://www.notion.so/${input.id.replace(/-/g, "")}`,
        created_time: "2026-10-01T00:00:00.000Z",
        last_edited_time: input.edited ?? "2026-10-20T10:00:00.000Z",
        in_trash: input.trashed ?? false,
        parent: input.parent ?? { type: "workspace", workspace: true },
        properties: {
            Name: { id: "title", type: "title", title: [{ plain_text: input.title }] },
            ...input.properties,
        },
    };
}

interface FakeWorkspace {
    pages: NotionPage[];
    bodies: Record<string, NotionPageMarkdown | "not-found">;
    pageSize?: number;
}

function fakeClient(workspace: FakeWorkspace): NotionClient & { markdownCalls: string[] } {
    const markdownCalls: string[] = [];
    const pageSize = workspace.pageSize ?? 100;
    return {
        markdownCalls,
        async searchPages(params): Promise<NotionSearchPage> {
            const start = params.startCursor ? Number(params.startCursor) : 0;
            const slice = workspace.pages.slice(start, start + pageSize);
            const next = start + pageSize;
            const more = next < workspace.pages.length;
            return {
                results: slice,
                has_more: more,
                next_cursor: more ? String(next) : null,
            };
        },
        async getPageMarkdown(id) {
            markdownCalls.push(id);
            const body = workspace.bodies[id];
            if (!body || body === "not-found") throw new NotionNotFoundError(`page ${id}`);
            return body;
        },
    };
}

function memorySink(): KnowledgeSink & { items: Map<string, KnowledgeItem> } {
    const items = new Map<string, KnowledgeItem>();
    let nextId = 1;
    return {
        items,
        async lastSyncedHash(item: DiscoveredKnowledgeItem) {
            return items.get(item.sourceId)?.contentHash ?? null;
        },
        async store(item: KnowledgeItem): Promise<StoredKnowledgeItem> {
            const revised = items.has(item.sourceId);
            items.set(item.sourceId, item);
            return {
                sourceId: item.sourceId,
                documentId: nextId,
                versionId: nextId++,
                jobId: null,
                revised,
            };
        },
    };
}

function body(id: string, markdown: string, extra: Partial<NotionPageMarkdown> = {}) {
    return { id, markdown, truncated: false, unknown_block_ids: [], ...extra };
}

describe("syncNotion", () => {
    it("stores every shared page as Markdown with its title and a link back", async () => {
        const client = fakeClient({
            pages: [page({ id: "p-1", title: "Roadmap" }), page({ id: "p-2", title: "Hiring" })],
            bodies: {
                "p-1": body("p-1", "## Q4\n\nShip the Notion connector."),
                "p-2": body("p-2", "Two engineers."),
            },
        });
        const sink = memorySink();

        const report = await syncNotion({ client, sink, workspaceName: "Acme" });

        expect(report.discovered).toBe(2);
        expect(report.stored).toHaveLength(2);
        const roadmap = sink.items.get("p-1")!;
        expect(roadmap.title).toBe("Roadmap");
        expect(roadmap.mimeType).toBe("text/markdown");
        expect(roadmap.metadata.extension).toBe(".md");
        expect(roadmap.content).toContain("# Roadmap");
        expect(roadmap.content).toContain("From Notion (Acme)");
        expect(roadmap.content).toContain("[Open in Notion](https://www.notion.so/p1)");
        expect(roadmap.content).toContain("Ship the Notion connector.");
        expect(roadmap.contentHash).toBe("notion:edited:2026-10-20T10:00:00.000Z");
    });

    it("skips an unchanged page without fetching its content", async () => {
        const workspace: FakeWorkspace = {
            pages: [page({ id: "p-1", title: "Roadmap" })],
            bodies: { "p-1": body("p-1", "v1") },
        };
        const sink = memorySink();
        await syncNotion({ client: fakeClient(workspace), sink });

        const client = fakeClient(workspace);
        const report = await syncNotion({ client, sink, knownSourceIds: ["p-1"] });

        expect(client.markdownCalls).toEqual([]);
        expect(report.stored).toHaveLength(0);
        expect(report.skipped).toEqual([{ sourceId: "p-1", reason: "unchanged" }]);
    });

    it("re-fetches a page whose last_edited_time moved", async () => {
        const sink = memorySink();
        await syncNotion({
            client: fakeClient({
                pages: [page({ id: "p-1", title: "Roadmap" })],
                bodies: { "p-1": body("p-1", "v1") },
            }),
            sink,
        });

        const report = await syncNotion({
            client: fakeClient({
                pages: [page({ id: "p-1", title: "Roadmap", edited: "2026-10-21T09:00:00.000Z" })],
                bodies: { "p-1": body("p-1", "v2") },
            }),
            sink,
            knownSourceIds: ["p-1"],
        });

        expect(report.stored).toEqual([
            expect.objectContaining({ sourceId: "p-1", revised: true }),
        ]);
        expect(sink.items.get("p-1")!.content).toContain("v2");
    });

    it("re-fetches everything when forced", async () => {
        const workspace: FakeWorkspace = {
            pages: [page({ id: "p-1", title: "Roadmap" })],
            bodies: { "p-1": body("p-1", "v1") },
        };
        const sink = memorySink();
        await syncNotion({ client: fakeClient(workspace), sink });

        const client = fakeClient(workspace);
        await syncNotion({ client, sink, force: true });

        expect(client.markdownCalls).toEqual(["p-1"]);
    });

    it("leaves trashed pages out and reports known pages that disappeared", async () => {
        const report = await syncNotion({
            client: fakeClient({
                pages: [
                    page({ id: "p-1", title: "Kept" }),
                    page({ id: "p-2", title: "Binned", trashed: true }),
                ],
                bodies: { "p-1": body("p-1", "here") },
            }),
            sink: memorySink(),
            knownSourceIds: ["p-1", "p-2", "p-3"],
        });

        expect(report.discovered).toBe(1);
        expect([...report.missingSourceIds].sort()).toEqual(["p-2", "p-3"]);
    });

    it("counts a page that 404s mid-run as missing, not failed", async () => {
        const report = await syncNotion({
            client: fakeClient({
                pages: [page({ id: "p-1", title: "Unshared" })],
                bodies: { "p-1": "not-found" },
            }),
            sink: memorySink(),
            knownSourceIds: ["p-1"],
        });

        expect(report.failed).toEqual([]);
        expect(report.notFound).toEqual(["p-1"]);
        expect(report.missingSourceIds).toEqual(["p-1"]);
    });

    it("cannot report deletions from a truncated listing", async () => {
        const report = await syncNotion({
            client: fakeClient({
                pages: [page({ id: "p-1", title: "A" }), page({ id: "p-2", title: "B" })],
                bodies: { "p-1": body("p-1", "a"), "p-2": body("p-2", "b") },
                pageSize: 1,
            }),
            sink: memorySink(),
            knownSourceIds: ["p-9"],
            maxPages: 1,
        });

        expect(report.truncated).toBe(true);
        expect(report.discovered).toBe(1);
        expect(report.missingSourceIds).toEqual([]);
    });

    it("walks every page of search results", async () => {
        const pages = Array.from({ length: 5 }, (_, i) => page({ id: `p-${i}`, title: `P${i}` }));
        const bodies = Object.fromEntries(pages.map(p => [p.id, body(p.id, p.id)]));
        const report = await syncNotion({
            client: fakeClient({ pages, bodies, pageSize: 2 }),
            sink: memorySink(),
        });

        expect(report.truncated).toBe(false);
        expect(report.stored).toHaveLength(5);
    });

    it("fills in subtrees a truncated page left out", async () => {
        const sink = memorySink();
        await syncNotion({
            client: fakeClient({
                pages: [page({ id: "p-1", title: "Long" })],
                bodies: {
                    "p-1": body(
                        "p-1",
                        'Start\n<unknown url="https://notion.so/p1#abc-123"/>\nEnd',
                        {
                            truncated: true,
                            unknown_block_ids: ["abc-123", "gone-1"],
                        }
                    ),
                    "abc-123": body("abc-123", "Middle part"),
                    "gone-1": "not-found",
                },
            }),
            sink,
        });

        const content = sink.items.get("p-1")!.content as string;
        expect(content).toContain("Start\nMiddle part\nEnd");
        expect(content).not.toContain("<unknown");
    });

    it("skips a page that renders larger than the limit", async () => {
        const report = await syncNotion({
            client: fakeClient({
                pages: [page({ id: "p-1", title: "Huge" })],
                bodies: { "p-1": body("p-1", "x".repeat(500)) },
            }),
            sink: memorySink(),
            maxItemBytes: 100,
        });

        expect(report.stored).toEqual([]);
        expect(report.skipped).toEqual([
            expect.objectContaining({ sourceId: "p-1", reason: "too-large" }),
        ]);
    });

    it("records a failure without stopping the run", async () => {
        const client = fakeClient({
            pages: [page({ id: "p-1", title: "A" }), page({ id: "p-2", title: "B" })],
            bodies: { "p-1": body("p-1", "a"), "p-2": body("p-2", "b") },
        });
        const failing: NotionClient = {
            searchPages: params => client.searchPages(params),
            async getPageMarkdown(id) {
                if (id === "p-1") throw new Error("boom");
                return client.getPageMarkdown(id);
            },
        };

        const report = await syncNotion({ client: failing, sink: memorySink() });

        expect(report.failed).toEqual([{ sourceId: "p-1", error: "Error: boom" }]);
        expect(report.stored).toHaveLength(1);
    });
});

describe("renderPage", () => {
    it("lists a database row's properties under its title", () => {
        const row = page({
            id: "r-1",
            title: "Launch Notion connector",
            parent: { type: "data_source_id", data_source_id: "ds-1" },
            properties: {
                Status: { type: "status", status: { name: "In progress" } },
                Tags: {
                    type: "multi_select",
                    multi_select: [{ name: "connectors" }, { name: "q4" }],
                },
                Due: { type: "date", date: { start: "2026-11-01", end: null } },
                Owner: { type: "people", people: [{ name: "Ada" }] },
                Points: { type: "number", number: 5 },
                Done: { type: "checkbox", checkbox: false },
                Blocked: { type: "relation", relation: [{ id: "x" }] },
            },
        });

        const markdown = renderPage(row, "Body text.");

        expect(markdown).toContain("# Launch Notion connector");
        expect(markdown).toContain("- **Status:** In progress");
        expect(markdown).toContain("- **Tags:** connectors, q4");
        expect(markdown).toContain("- **Due:** 2026-11-01");
        expect(markdown).toContain("- **Owner:** Ada");
        expect(markdown).toContain("- **Points:** 5");
        expect(markdown).toContain("- **Done:** No");
        expect(markdown).not.toContain("Blocked");
        expect(markdown).toContain("Body text.");
    });

    it("leaves a plain page's properties out", () => {
        const plain = page({
            id: "p-1",
            title: "Notes",
            properties: { Extra: { type: "rich_text", rich_text: [{ plain_text: "hidden" }] } },
        });
        expect(renderPage(plain, "Hi")).not.toContain("hidden");
    });

    it("names an untitled page", () => {
        expect(pageTitle({ ...page({ id: "p", title: "" }) })).toBe("Untitled");
    });

    it("reads formula and unique id values", () => {
        expect(propertyText({ type: "formula", formula: { type: "number", number: 42 } })).toBe(
            "42"
        );
        expect(propertyText({ type: "unique_id", unique_id: { prefix: "ENG", number: 7 } })).toBe(
            "ENG-7"
        );
        expect(propertyText({ type: "rich_text", rich_text: [] })).toBeNull();
    });

    it("appends a subtree whose placeholder is missing", () => {
        expect(mergeUnknownSubtrees("Top", new Map([["zzz", "Tail"]]))).toBe("Top\n\nTail");
    });
});

describe("createNotionClient", () => {
    function recordingFetch(responses: Response[]) {
        const calls: { url: string; init?: RequestInit }[] = [];
        return {
            calls,
            fetch: async (url: string, init?: RequestInit) => {
                calls.push({ url, init });
                const next = responses.shift();
                if (!next) throw new Error("no more responses");
                return next;
            },
        };
    }

    const json = (status: number, payload: unknown, headers: Record<string, string> = {}) =>
        new Response(JSON.stringify(payload), {
            status,
            headers: { "Content-Type": "application/json", ...headers },
        });

    it("searches pages with the version header and a bearer token", async () => {
        const { calls, fetch } = recordingFetch([
            json(200, { results: [], has_more: false, next_cursor: null }),
        ]);
        const client = createNotionClient({ accessToken: "tok", fetch });

        await client.searchPages({ pageSize: 50 });

        expect(calls[0]!.url).toBe("https://api.notion.com/v1/search");
        const headers = calls[0]!.init?.headers as Record<string, string>;
        expect(headers.Authorization).toBe("Bearer tok");
        expect(headers["Notion-Version"]).toBe("2026-03-11");
        expect(JSON.parse(calls[0]!.init?.body as string)).toEqual({
            filter: { property: "object", value: "page" },
            sort: { timestamp: "last_edited_time", direction: "descending" },
            page_size: 50,
        });
    });

    it("waits out a rate limit and retries", async () => {
        const waits: number[] = [];
        const { calls, fetch } = recordingFetch([
            json(429, { code: "rate_limited", message: "slow down" }, { "Retry-After": "2" }),
            json(200, { id: "p", markdown: "ok", truncated: false }),
        ]);
        const client = createNotionClient({
            accessToken: "tok",
            fetch,
            sleep: async ms => {
                waits.push(ms);
            },
        });

        const result = await client.getPageMarkdown("p");

        expect(result.markdown).toBe("ok");
        expect(waits).toEqual([2000]);
        expect(calls).toHaveLength(2);
        expect(calls[1]!.url).toBe("https://api.notion.com/v1/pages/p/markdown");
    });

    it("maps 401 and 404 to typed errors", async () => {
        const unauthorized = createNotionClient({
            accessToken: "tok",
            fetch: recordingFetch([
                json(401, { code: "unauthorized", message: "API token is invalid." }),
            ]).fetch,
        });
        await expect(unauthorized.searchPages({})).rejects.toBeInstanceOf(NotionAuthError);

        const missing = createNotionClient({
            accessToken: "tok",
            fetch: recordingFetch([json(404, { code: "object_not_found", message: "nope" })]).fetch,
        });
        await expect(missing.getPageMarkdown("p")).rejects.toBeInstanceOf(NotionNotFoundError);
    });
});

describe("syncNotion when the token dies mid-run", () => {
    it("stops and rethrows the 401 instead of recording every page as failed", async () => {
        const pages = Array.from({ length: 6 }, (_, i) => page({ id: `p-${i}`, title: `P${i}` }));
        const reads: string[] = [];
        const client: NotionClient = {
            async searchPages() {
                return { results: pages, has_more: false, next_cursor: null };
            },
            async getPageMarkdown(id) {
                reads.push(id);
                if (id === "p-1") throw new NotionAuthError("API token is invalid.");
                return body(id, id);
            },
        };

        await expect(
            syncNotion({ client, sink: memorySink(), concurrency: 1 })
        ).rejects.toBeInstanceOf(NotionAuthError);
        // One worker: p-0 succeeded, p-1 hit the 401, nothing after it started.
        expect(reads).toEqual(["p-0", "p-1"]);
    });
});
