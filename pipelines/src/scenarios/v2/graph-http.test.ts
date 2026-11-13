import { describe, expect, it } from "vitest";

import { BASE_ONTOLOGY, GraphUnavailableError, type GraphEpisodeInput } from "./contracts";
import { createGraphitiHttpPort, GraphHttpError } from "./graph-http";

interface Sent {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: unknown;
}

/** A fake fetch: records each request and answers with the next reply. */
function fakeFetch(...replies: Array<{ status?: number; body?: unknown; text?: string } | Error>) {
    const sent: Sent[] = [];
    const impl = (async (input: string | URL | Request, init?: RequestInit) => {
        sent.push({
            url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
            method: init?.method ?? "GET",
            headers: init?.headers as Record<string, string>,
            body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        });
        const reply = replies.shift();
        if (!reply) throw new Error("no reply queued");
        if (reply instanceof Error) throw reply;
        const text = reply.text ?? JSON.stringify(reply.body ?? {});
        return new Response(text, { status: reply.status ?? 200 });
    }) as typeof fetch;
    return { impl, sent };
}

/** A fetch that never answers until aborted, like a hung service. */
const hangingFetch = ((_: unknown, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("This operation was aborted", "AbortError"))
        );
    })) as typeof fetch;

function port(
    fetchImpl: typeof fetch,
    extra: { timeoutMs?: number; ingestTimeoutMs?: number } = {}
) {
    return createGraphitiHttpPort({
        baseUrl: "http://scenario-graph:8000/",
        token: "secret-token",
        fetch: fetchImpl,
        ...extra,
    });
}

const EPISODES: GraphEpisodeInput[] = [
    {
        uuid: "b1-E1",
        name: "E1",
        body: "Maya recommends Northwind's software purchases; Lee approves them.",
        sourceDescription: "contacts.pdf v3 p2",
        referenceTime: "2026-11-01T12:00:00.000Z",
        evidenceId: "E1",
    },
    {
        uuid: "b1-E2",
        name: "E2",
        body: "Northwind uses Acme Legacy. Migration requires approximately fourteen days.",
        sourceDescription: "renewal.pdf v5 p4",
        referenceTime: "2026-11-01T12:00:00.000Z",
        evidenceId: "E2",
    },
];

const WIRE_EDGE = {
    uuid: "edge-1",
    name: "APPROVES",
    fact: "Lee approves Northwind's software purchases.",
    source_node_uuid: "node-lee",
    target_node_uuid: "node-decision",
    episodes: ["b1-E1"],
    valid_at: "2026-11-01T12:00:00+00:00",
    invalid_at: null,
    attributes: {},
};

describe("createGraphitiHttpPort", () => {
    it("ingests in snake_case and maps outcomes and usage back", async () => {
        const { impl, sent } = fakeFetch({
            body: {
                outcomes: [
                    { uuid: "b1-E1", status: "done" },
                    { uuid: "b1-E2", status: "failed", error: "ValueError" },
                ],
                usage: {
                    calls: 9,
                    input_tokens: 4200,
                    output_tokens: 610,
                    embedding_tokens: 88,
                    unmetered_calls: 0,
                },
            },
        });
        const result = await port(impl).ingest({
            groupId: "build-1",
            ontology: BASE_ONTOLOGY,
            episodes: EPISODES,
        });

        expect(result).toEqual({
            outcomes: [
                { uuid: "b1-E1", status: "done" },
                { uuid: "b1-E2", status: "failed", error: "ValueError" },
            ],
            usage: { calls: 9, inputTokens: 4200, outputTokens: 610, embeddingTokens: 88 },
        });

        const [request] = sent;
        expect(request!.method).toBe("POST");
        expect(request!.url).toBe("http://scenario-graph:8000/v1/groups/build-1/episodes");
        expect(request!.headers.Authorization).toBe("Bearer secret-token");
        const body = request!.body as {
            ontology: {
                entities: Array<Record<string, unknown>>;
                edges: Array<Record<string, unknown>>;
            };
            episodes: Array<Record<string, unknown>>;
        };
        expect(body.episodes[0]).toEqual({
            uuid: "b1-E1",
            name: "E1",
            body: "Maya recommends Northwind's software purchases; Lee approves them.",
            source_description: "contacts.pdf v3 p2",
            reference_time: "2026-11-01T12:00:00.000Z",
        });
        // evidenceId stays in our records.
        expect(JSON.stringify(body)).not.toContain("evidenceId");
        expect(body.ontology.entities[1]).toEqual({
            name: "Person",
            description: "A named or described individual and their role.",
            attributes: [
                { name: "title", type: "string", description: "Job title or role, as stated." },
            ],
            origin: "base",
            motivating_evidence_id: null,
        });
        expect(body.ontology.edges.find(e => e.name === "USES")?.endpoints).toEqual([
            { source: "Organization", target: "Product" },
            { source: "Person", target: "Product" },
        ]);
    });

    it("reports one outcome per episode, in input order, even if the reply drops one", async () => {
        const { impl } = fakeFetch({
            body: {
                outcomes: [{ uuid: "b1-E2", status: "done" }],
                usage: { calls: 1, input_tokens: 1, output_tokens: 1, embedding_tokens: 0 },
            },
        });
        const { outcomes } = await port(impl).ingest({
            groupId: "build-1",
            ontology: BASE_ONTOLOGY,
            episodes: EPISODES,
        });
        expect(outcomes).toEqual([
            { uuid: "b1-E1", status: "failed", error: "no outcome reported" },
            { uuid: "b1-E2", status: "done" },
        ]);
    });

    it("does not call the service for an empty batch", async () => {
        const { impl, sent } = fakeFetch();
        const result = await port(impl).ingest({
            groupId: "build-1",
            ontology: BASE_ONTOLOGY,
            episodes: [],
        });
        expect(result.outcomes).toEqual([]);
        expect(sent).toHaveLength(0);
    });

    it("maps search hits, export and episode listing to camelCase", async () => {
        const node = {
            uuid: "node-lee",
            name: "Lee",
            labels: ["Entity", "Person"],
            summary: "",
            attributes: { title: "CFO" },
        };
        const { impl, sent } = fakeFetch(
            { body: { hits: [{ edge: WIRE_EDGE, score: 1 }] } },
            { body: { nodes: [node], edges: [WIRE_EDGE], episode_uuids: ["b1-E1"] } },
            { body: { uuids: ["b1-E1", "b1-E2"] } },
            { body: { deleted_nodes: 7 } }
        );
        const graph = port(impl);

        const expectedEdge = {
            uuid: "edge-1",
            name: "APPROVES",
            fact: "Lee approves Northwind's software purchases.",
            sourceUuid: "node-lee",
            targetUuid: "node-decision",
            episodeUuids: ["b1-E1"],
            validAt: "2026-11-01T12:00:00+00:00",
            invalidAt: null,
            attributes: {},
        };
        expect(await graph.search({ groupId: "build-1", query: "who approves", limit: 5 })).toEqual(
            [{ edge: expectedEdge, score: 1 }]
        );
        expect(await graph.exportGroup("build-1")).toEqual({
            nodes: [node],
            edges: [expectedEdge],
            episodeUuids: ["b1-E1"],
        });
        expect(await graph.listEpisodes("build-1")).toEqual(["b1-E1", "b1-E2"]);
        await expect(graph.deleteGroup("build-1")).resolves.toBeUndefined();

        expect(sent.map(s => `${s.method} ${new URL(s.url).pathname}`)).toEqual([
            "POST /v1/groups/build-1/search",
            "GET /v1/groups/build-1/export",
            "GET /v1/groups/build-1/episodes",
            "DELETE /v1/groups/build-1",
        ]);
        expect(sent[0]!.body).toEqual({ query: "who approves", limit: 5 });
    });

    it.each([502, 503, 504])("treats %i as the graph being unavailable", async status => {
        const { impl } = fakeFetch({ status, body: { detail: "graph database unavailable" } });
        const error = await port(impl)
            .listEpisodes("build-1")
            .catch(e => e);
        expect(error).toBeInstanceOf(GraphUnavailableError);
        expect(error.message).toBe(
            `Scenario graph service: GET /v1/groups/build-1/episodes answered ${status}`
        );
    });

    it("treats a network error as the graph being unavailable", async () => {
        const { impl } = fakeFetch(new TypeError("fetch failed"));
        const error = await port(impl)
            .exportGroup("build-1")
            .catch(e => e);
        expect(error).toBeInstanceOf(GraphUnavailableError);
        expect(error.message).toContain("fetch failed");
    });

    it("times out a hung call as unavailable", async () => {
        const error = await port(hangingFetch, { timeoutMs: 20 })
            .listEpisodes("build-1")
            .catch(e => e);
        expect(error).toBeInstanceOf(GraphUnavailableError);
        expect(error.message).toContain("timed out after 20 ms");
    });

    it("gives ingest its own, longer timeout", async () => {
        const error = await port(hangingFetch, { timeoutMs: 1, ingestTimeoutMs: 30 })
            .ingest({ groupId: "build-1", ontology: BASE_ONTOLOGY, episodes: EPISODES })
            .catch(e => e);
        expect(error).toBeInstanceOf(GraphUnavailableError);
        expect(error.message).toContain("timed out after 30 ms");
    });

    it("surfaces other statuses with a bounded detail and no request text", async () => {
        const { impl } = fakeFetch({
            status: 422,
            body: {
                detail: "invalid ontology",
                errors: Array.from({ length: 40 }, (_, i) => `entity type 'T${i}' is reserved`),
            },
        });
        const error = await port(impl)
            .ingest({ groupId: "build-1", ontology: BASE_ONTOLOGY, episodes: EPISODES })
            .catch(e => e);
        expect(error).toBeInstanceOf(GraphHttpError);
        expect(error.status).toBe(422);
        expect(error.message).toMatch(
            /^Scenario graph service: POST \/v1\/groups\/build-1\/episodes answered 422: invalid ontology — /
        );
        expect(error.message).not.toContain("Maya");
        const detail = error.message.split("answered 422: ")[1] as string;
        expect(detail.length).toBeLessThanOrEqual(200);
    });

    it("never echoes a long non-JSON body", async () => {
        const { impl } = fakeFetch({ status: 500, text: "x".repeat(5000) });
        const error = await port(impl)
            .listEpisodes("build-1")
            .catch(e => e);
        expect(error).toBeInstanceOf(GraphHttpError);
        expect(error.message.length).toBeLessThan(300);
    });

    it("refuses a reply of the wrong shape", async () => {
        const { impl } = fakeFetch({ body: { uuids: "not-a-list" } });
        await expect(port(impl).listEpisodes("build-1")).rejects.toThrow("unexpected shape");
    });

    it("refuses an invalid group id before sending anything", async () => {
        const { impl, sent } = fakeFetch();
        for (const bad of ["", "a b", "../x", "x".repeat(129), "dot.ted"]) {
            await expect(port(impl).listEpisodes(bad)).rejects.toThrow(
                "Invalid scenario graph group id"
            );
        }
        expect(sent).toHaveLength(0);
    });

    describe("health", () => {
        it("returns versions", async () => {
            const { impl, sent } = fakeFetch({
                body: { ok: true, graphiti: "0.31.2", neo4j: "5.26.33-community" },
            });
            expect(await port(impl).health()).toEqual({
                ok: true,
                graphiti: "0.31.2",
                neo4j: "5.26.33-community",
            });
            expect(sent[0]!.url).toBe("http://scenario-graph:8000/healthz");
            expect(sent[0]!.headers.Authorization).toBe("Bearer secret-token");
        });

        it("reports a down service as not ok instead of throwing", async () => {
            const down = fakeFetch({
                status: 503,
                body: { ok: false, graphiti: null, neo4j: null },
            });
            expect(await port(down.impl).health()).toEqual({
                ok: false,
                graphiti: null,
                neo4j: null,
            });
            const unreachable = fakeFetch(new TypeError("ECONNREFUSED"));
            expect(await port(unreachable.impl).health()).toEqual({
                ok: false,
                graphiti: null,
                neo4j: null,
            });
            expect(await port(hangingFetch, { timeoutMs: 10 }).health()).toEqual({
                ok: false,
                graphiti: null,
                neo4j: null,
            });
        });

        it("throws on a rejected token, which is a configuration error", async () => {
            const { impl } = fakeFetch({ status: 401, body: { detail: "Unauthorized" } });
            const error = await port(impl)
                .health()
                .catch(e => e);
            expect(error).toBeInstanceOf(GraphHttpError);
            expect(error.status).toBe(401);
        });
    });
});
