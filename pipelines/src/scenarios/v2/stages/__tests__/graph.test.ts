import { describe, expect, it } from "vitest";

import { V2_VERSIONS } from "../../contracts";
import { hashOf, sha256Hex } from "../../hash";
import { RetryLaterError } from "../../stage";
import { episodeUuid, graphBuildKey, graphGroupId } from "../common";
import { freezeGraph, graphIdentity } from "../graph";
import {
    fakeGraph,
    groundingExtraction,
    makeHarness,
    MemoryArtifacts,
    runAll,
    runUnit,
    section,
    type Harness,
} from "./harness";

async function upToGraph(h: Harness): Promise<void> {
    await runUnit(h, "sources");
    await runUnit(h, "ontology");
}

function graphHarness(artifacts?: MemoryArtifacts, runId = 41) {
    const graph = fakeGraph(groundingExtraction);
    const h = makeHarness({
        spec: { contextMode: "graph" },
        graph: graph.port,
        run: { id: runId },
        ...(artifacts ? { artifacts } : {}),
    });
    return { h, graph };
}

describe("graph build identity", () => {
    it("keys a build by company, manifest, ontology and extraction policy", () => {
        const key = graphBuildKey(5n, "m", "o", "graphiti-extract@1");
        expect(key).toBe(sha256Hex("5|m|o|graphiti-extract@1"));
        expect(graphGroupId(5n, key)).toBe(`ls_5_${key.slice(0, 24)}`);
        expect(graphBuildKey(5n, "m", "o", "graphiti-extract@2")).not.toBe(key);
        expect(graphBuildKey(6n, "m", "o", "graphiti-extract@1")).not.toBe(key);
    });

    it("gives each episode a uuid-shaped id that is the same on every retry", () => {
        const a = episodeUuid("key", "E1");
        expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(episodeUuid("key", "E1")).toBe(a);
        expect(episodeUuid("key", "E2")).not.toBe(a);
        expect(episodeUuid("other", "E1")).not.toBe(a);
    });
});

describe("graph:prepare", () => {
    it("claims a new build and plans one ingestion unit per batch of sections", async () => {
        const { h } = graphHarness();
        h.spec.policies.ingestBatchSize = 1;
        await upToGraph(h);
        const result = await runUnit(h, "graph:prepare");
        const id = graphIdentity(h, h.artifacts.manifest!, h.artifacts.ontology!);
        expect(result.writes).toEqual([
            expect.objectContaining({
                type: "graph_build",
                buildKey: id.buildKey,
                groupId: id.groupId,
                state: "ingesting",
                policyVersion: V2_VERSIONS.extractionPolicy,
            }),
        ]);
        expect(result.followUps?.map(f => [f.key, f.input])).toEqual([
            ["graph:ingest:01", { batch: 1, evidenceIds: ["E1"] }],
            ["graph:ingest:02", { batch: 2, evidenceIds: ["E2"] }],
        ]);
        expect(h.artifacts.builds.get(id.buildKey)?.ownerRunId).toBe(41);
    });

    it("reuses a frozen build: no ingestion, no new snapshot", async () => {
        const first = graphHarness();
        await runAll(first.h, "graph:freeze");
        const frozen = [...first.h.artifacts.builds.values()][0]!;
        expect(frozen.state).toBe("frozen");

        // A second run over the same evidence and schema, sharing the company's builds.
        const shared = new MemoryArtifacts();
        shared.builds = first.h.artifacts.builds;
        shared.snapshots = first.h.artifacts.snapshots;
        shared.ingestions = first.h.artifacts.ingestions;
        const second = graphHarness(shared, 42);
        second.h.graph = first.h.graph;
        await upToGraph(second.h);
        const prepared = await runUnit(second.h, "graph:prepare");
        expect(prepared.followUps ?? []).toEqual([]);
        expect(prepared.output).toMatchObject({ reused: true, groupId: frozen.groupId });
        const freeze = await runUnit(second.h, "graph:freeze");
        expect(freeze.writes ?? []).toEqual([]);
        expect(freeze.output).toMatchObject({ reused: true, snapshotId: frozen.snapshotId });
        expect(first.graph.calls.export).toBe(1);
    });

    it("waits while another live run owns the build, and takes over from a finished one", async () => {
        const { h } = graphHarness();
        await upToGraph(h);
        const id = graphIdentity(h, h.artifacts.manifest!, h.artifacts.ontology!);
        h.artifacts.builds.set(id.buildKey, {
            id: 900,
            companyId: 5n,
            buildKey: id.buildKey,
            groupId: id.groupId,
            state: "ingesting",
            ownerRunId: 7,
            ownerEpoch: 1,
            manifestHash: id.manifestHash,
            ontologyHash: id.ontologyHash,
            policyVersion: id.policyVersion,
            snapshotId: null,
            error: null,
        });
        await expect(runUnit(h, "graph:prepare")).rejects.toBeInstanceOf(RetryLaterError);

        h.artifacts.builds.get(id.buildKey)!.ownerLive = false;
        const result = await runUnit(h, "graph:prepare");
        expect(result.writes?.[0]).toMatchObject({ type: "graph_build", takeOver: true });
        expect(h.artifacts.builds.get(id.buildKey)).toMatchObject({
            ownerRunId: 41,
            ownerEpoch: 2,
        });
    });
});

describe("graph:ingest", () => {
    it("submits only episodes the group lacks, under deterministic uuids, and reports graph usage", async () => {
        const { h, graph } = graphHarness();
        await upToGraph(h);
        await runUnit(h, "graph:prepare");
        const build = [...h.artifacts.builds.values()][0]!;
        // A crash after Graphiti stored E1 but before the unit committed.
        await graph.port.ingest({
            groupId: build.groupId,
            ontology: h.artifacts.ontology!.schema,
            episodes: [
                {
                    uuid: episodeUuid(build.buildKey, "E1"),
                    name: "E1",
                    body: h.artifacts.manifest!.items[0]!.quote,
                    sourceDescription: "",
                    referenceTime: "",
                    evidenceId: "E1",
                },
            ],
        });
        graph.calls.submitted = [];
        const result = await runUnit(h, "graph:ingest:01");
        expect(graph.calls.submitted).toEqual(["E2"]);
        expect(result.writes).toEqual([
            {
                type: "graph_ingestion",
                buildKey: build.buildKey,
                unitKey: "graph:ingest:01",
                evidenceIds: ["E1", "E2"],
                episodeUuids: [
                    episodeUuid(build.buildKey, "E1"),
                    episodeUuid(build.buildKey, "E2"),
                ],
                status: "done",
                error: null,
            },
        ]);
        // 3 calls, 900 in + 50 embedding, 200 out per submitted episode.
        expect(result.extraUsage).toEqual({ calls: 3, inputTokens: 950, outputTokens: 200 });
        // Running it again submits nothing.
        graph.calls.submitted = [];
        const again = await runUnit(h, "graph:ingest:01");
        expect(graph.calls.submitted).toEqual([]);
        expect(again.extraUsage).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0 });
    });

    it("waits when the graph service is down", async () => {
        const { h, graph } = graphHarness();
        await upToGraph(h);
        await runUnit(h, "graph:prepare");
        graph.state.up = false;
        await expect(runUnit(h, "graph:ingest:01")).rejects.toBeInstanceOf(RetryLaterError);
    });

    it("does not write to a build another run took over", async () => {
        const { h } = graphHarness();
        await upToGraph(h);
        await runUnit(h, "graph:prepare");
        const build = [...h.artifacts.builds.values()][0]!;
        build.ownerRunId = 99;
        await expect(runUnit(h, "graph:ingest:01")).rejects.toBeInstanceOf(RetryLaterError);
    });
});

describe("graph:freeze", () => {
    it("keeps provenance from our records, supports only edges a passage names both ends of, and never merges by name", async () => {
        const { h } = graphHarness();
        h.collection.sections.push(
            section({
                text: "Lee from Contoso signs the order forms.",
                sourceId: "9",
                label: "contoso.pdf, page 1",
                locator: {
                    documentId: 9,
                    versionId: 1,
                    chunkId: 300,
                    page: 1,
                    section: null,
                    providerId: null,
                },
                documentIds: [9],
            })
        );
        await runAll(h, "graph:freeze");
        const build = [...h.artifacts.builds.values()][0]!;
        expect(build.state).toBe("frozen");
        const data = h.artifacts.snapshots.get(build.id)!.data;

        expect(Object.values(data.episodes).sort()).toEqual(["E1", "E2", "E3"]);
        expect(data.coverage).toEqual({ ingested: ["E1", "E2", "E3"], failed: [] });
        const edge = (uuid: string) => data.edges.find(e => e.uuid === uuid)!;
        expect(edge("e-maya-influences")).toMatchObject({ evidenceIds: ["E1"], supported: true });
        expect(edge("e-maya-works-for")).toMatchObject({ evidenceIds: ["E1"], supported: true });
        expect(edge("e-northwind-uses")).toMatchObject({ evidenceIds: ["E2"], supported: true });
        // E2 never names Maya: kept for inspection, never shown to an actor.
        expect(edge("e-maya-uses")).toMatchObject({ evidenceIds: ["E2"], supported: false });
        // Two people called Lee, from two documents, stay two people.
        expect(data.nodes.filter(n => n.name === "Lee").map(n => n.uuid)).toEqual([
            "n-lee-1",
            "n-lee-2",
        ]);
        expect(data.unresolvedIdentities).toEqual([{ name: "Lee", uuids: ["n-lee-1", "n-lee-2"] }]);
        const { graphHash, ...body } = data;
        expect(graphHash).toBe(hashOf(body));
    });

    it("ignores episodes Graphiti claims that our records do not hold", () => {
        const data = freezeGraph(
            {
                nodes: [
                    { uuid: "a", name: "Maya", labels: ["Person"], summary: "", attributes: {} },
                    { uuid: "b", name: "Northwind", labels: [], summary: "", attributes: {} },
                ],
                edges: [
                    {
                        uuid: "x",
                        name: "WORKS_FOR",
                        fact: "Maya works for Northwind.",
                        sourceUuid: "a",
                        targetUuid: "b",
                        episodeUuids: ["foreign-episode"],
                        validAt: null,
                        invalidAt: null,
                        attributes: {},
                    },
                ],
                episodeUuids: ["foreign-episode", "u1"],
            },
            [{ evidenceIds: ["E1", "E2"], episodeUuids: ["u1", "u2"] }],
            {
                items: [
                    { id: "E1", quote: "Maya works for Northwind." },
                    { id: "E2", quote: "Other." },
                ] as never,
            }
        );
        expect(data.episodes).toEqual({ u1: "E1", u2: "E2" });
        expect(data.coverage).toEqual({ ingested: ["E1"], failed: ["E2"] });
        expect(data.edges[0]).toMatchObject({ evidenceIds: [], supported: false });
    });
});
