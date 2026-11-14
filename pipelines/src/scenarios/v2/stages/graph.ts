/**
 * Graph mode: `graph:prepare` → `graph:ingest:NN` → `graph:freeze`.
 *
 * A build is identified by sha-256(company | manifest | ontology | extraction
 * policy), so two runs over the same evidence and schema share one Graphiti
 * group. Prepare reuses a frozen build, waits on one another live run is
 * building, and otherwise claims it and plans the ingestion units. Ingest
 * reconciles what the group already holds and submits only the missing
 * episodes, under deterministic uuids. Freeze exports the group and keeps
 * provenance from our own ingestion records (never from Graphiti): an edge is
 * supported only when a passage it was extracted from names both endpoints,
 * and same-name nodes are listed, never merged.
 */
import type {
    EvidenceSnapshot,
    GraphEdge,
    GraphExport,
    GraphNode,
    GraphSnapshotData,
    OntologySpec,
    SnapshotEdge,
    SourceManifest,
} from "../contracts";
import { hashOf } from "../hash";
import { ingestUnits, unitKeys } from "../plan";
import {
    RetryLaterError,
    type GraphBuildRecord,
    type GraphIngestionRecord,
    type Stage,
    type StageContext,
} from "../stage";
import {
    episodeUuid,
    evidenceNumber,
    graphBuildKey,
    graphGroupId,
    inputStrings,
    mentions,
    requireGraph,
    requireManifest,
    sortEvidenceIds,
    withGraph,
} from "./common";

export interface GraphIdentity {
    buildKey: string;
    groupId: string;
    policyVersion: string;
    manifestHash: string;
    ontologyHash: string;
}

async function requireOntology(ctx: StageContext): Promise<OntologySpec & { id: number }> {
    const spec = await ctx.artifacts.ontologySpec();
    if (!spec) throw new Error("The run has no ontology yet");
    return spec;
}

/** The build this run's manifest and ontology name. */
export function graphIdentity(
    ctx: Pick<StageContext, "run" | "spec">,
    manifest: Pick<SourceManifest, "manifestHash">,
    ontology: Pick<OntologySpec, "ontologyHash">
): GraphIdentity {
    const policyVersion = ctx.spec.policies.versions.extractionPolicy;
    const buildKey = graphBuildKey(
        ctx.run.companyId,
        manifest.manifestHash,
        ontology.ontologyHash,
        policyVersion
    );
    return {
        buildKey,
        groupId: graphGroupId(ctx.run.companyId, buildKey),
        policyVersion,
        manifestHash: manifest.manifestHash,
        ontologyHash: ontology.ontologyHash,
    };
}

async function identityFor(ctx: StageContext): Promise<{
    manifest: SourceManifest;
    ontology: OntologySpec & { id: number };
    id: GraphIdentity;
}> {
    const manifest = await requireManifest(ctx);
    const ontology = await requireOntology(ctx);
    return { manifest, ontology, id: graphIdentity(ctx, manifest, ontology) };
}

/** A build another run started and can no longer finish. */
function ownerFinished(build: GraphBuildRecord): boolean {
    return build.state === "failed" || build.ownerRunId === null || build.ownerLive === false;
}

/** Waits while another run owns the build; a frozen build needs no owner. */
function fence(ctx: StageContext, build: GraphBuildRecord): void {
    if (build.ownerRunId !== ctx.run.id)
        throw new RetryLaterError(
            `Graph build ${build.buildKey.slice(0, 12)} is owned by run ${build.ownerRunId}`
        );
}

function buildWrite(
    id: GraphIdentity,
    groupId: string,
    state: "ingesting" | "frozen",
    takeOver?: boolean
) {
    return {
        type: "graph_build" as const,
        buildKey: id.buildKey,
        groupId,
        manifestHash: id.manifestHash,
        ontologyHash: id.ontologyHash,
        policyVersion: id.policyVersion,
        state,
        ...(takeOver ? { takeOver: true } : {}),
        error: null,
    };
}

// ─── graph:prepare ───────────────────────────────────────────────────────────

export const graphPrepareStage: Stage = async ctx => {
    const { manifest, id } = await identityFor(ctx);
    const existing = await ctx.artifacts.graphBuild(id.buildKey);
    if (existing?.state === "frozen") {
        return {
            output: {
                buildKey: id.buildKey,
                groupId: existing.groupId,
                reused: true,
                ingestUnits: 0,
            },
        };
    }
    const mine = existing?.ownerRunId === ctx.run.id;
    if (existing && !mine && !ownerFinished(existing)) {
        throw new RetryLaterError(
            `Graph build ${id.buildKey.slice(0, 12)} is being built by run ${existing.ownerRunId}`
        );
    }
    // A build keeps the group it was created with.
    const groupId = existing?.groupId ?? id.groupId;
    const followUps = ingestUnits(
        ctx.spec,
        manifest.items.map(i => ({ id: i.id, tokens: i.tokens }))
    );
    return {
        output: {
            buildKey: id.buildKey,
            groupId,
            reused: false,
            takeOver: !!existing && !mine,
            ingestUnits: followUps.length,
        },
        writes: [buildWrite(id, groupId, "ingesting", !!existing && !mine)],
        followUps,
    };
};

// ─── graph:ingest:NN ─────────────────────────────────────────────────────────

export function episodeFor(buildKey: string, item: EvidenceSnapshot) {
    return {
        uuid: episodeUuid(buildKey, item.id),
        name: `${item.id} · ${item.label}`,
        body: item.quote,
        sourceDescription: `${item.kind}: ${item.label}`,
        referenceTime: item.capturedAt,
        evidenceId: item.id,
    };
}

export const graphIngestStage: Stage = async ctx => {
    const { manifest, ontology, id } = await identityFor(ctx);
    const build = await ctx.artifacts.graphBuild(id.buildKey);
    if (!build) throw new Error(`Graph build ${id.buildKey.slice(0, 12)} does not exist`);
    // Another run finished the build meanwhile: nothing left to add.
    if (build.state === "frozen") return { output: { unit: ctx.unit.key, skipped: "frozen" } };
    fence(ctx, build);

    const byId = new Map(manifest.items.map(i => [i.id, i]));
    const evidenceIds = inputStrings(ctx, "evidenceIds");
    const episodes = evidenceIds.map(eid => {
        const item = byId.get(eid);
        if (!item) throw new Error(`Evidence ${eid} is not in the manifest`);
        return episodeFor(id.buildKey, item);
    });

    const graph = requireGraph(ctx);
    // Reconcile first: a crash after Graphiti stored an episode must not add it twice.
    const stored = new Set(await withGraph(() => graph.listEpisodes(build.groupId)));
    const missing = episodes.filter(e => !stored.has(e.uuid));
    const { outcomes, usage } =
        missing.length > 0
            ? await withGraph(() =>
                  graph.ingest({
                      groupId: build.groupId,
                      ontology: ontology.schema,
                      episodes: missing,
                  })
              )
            : {
                  outcomes: [],
                  usage: { calls: 0, inputTokens: 0, outputTokens: 0, embeddingTokens: 0 },
              };
    const done = new Set(stored);
    const reasons: string[] = [];
    for (const o of outcomes) {
        if (o.status === "done") done.add(o.uuid);
        else if (o.error) reasons.push(o.error);
    }
    const failed = episodes.filter(e => !done.has(e.uuid)).map(e => e.evidenceId);
    return {
        output: {
            unit: ctx.unit.key,
            submitted: missing.length,
            alreadyStored: episodes.length - missing.length,
            failed,
        },
        writes: [
            {
                type: "graph_ingestion",
                buildKey: id.buildKey,
                unitKey: ctx.unit.key,
                evidenceIds,
                episodeUuids: episodes.map(e => e.uuid),
                status: failed.length > 0 ? "failed" : "done",
                error:
                    failed.length > 0
                        ? `Not ingested: ${failed.join(", ")}${reasons.length ? ` (${[...new Set(reasons)].join("; ")})` : ""}`
                        : null,
            },
        ],
        // Graph-side provider spend. Embeddings are priced like chat tokens
        // (TOKEN_COSTS.embedding = llm_chat = 1), so they settle as input.
        extraUsage: {
            calls: usage.calls,
            inputTokens: usage.inputTokens + usage.embeddingTokens,
            outputTokens: usage.outputTokens,
        },
    };
};

// ─── graph:freeze ────────────────────────────────────────────────────────────

function cleanNode(n: GraphNode): GraphNode {
    return {
        uuid: n.uuid,
        name: n.name,
        labels: [...n.labels].sort(),
        summary: n.summary ?? "",
        attributes: n.attributes ?? {},
    };
}

function cleanEdge(e: GraphEdge): GraphEdge {
    return {
        uuid: e.uuid,
        name: e.name,
        fact: e.fact,
        sourceUuid: e.sourceUuid,
        targetUuid: e.targetUuid,
        episodeUuids: [...e.episodeUuids].sort(),
        validAt: e.validAt ?? null,
        invalidAt: e.invalidAt ?? null,
        attributes: e.attributes ?? {},
    };
}

/**
 * The frozen snapshot of an exported group. Provenance comes from
 * `ingestions` (our records), presence from the export; support is checked
 * against the manifest's own passages. Pure and order-independent.
 */
export function freezeGraph(
    exported: GraphExport,
    ingestions: Array<Pick<GraphIngestionRecord, "evidenceIds" | "episodeUuids">>,
    manifest: Pick<SourceManifest, "items">
): GraphSnapshotData {
    const quotes = new Map(manifest.items.map(i => [i.id, i.quote]));
    const episodes: Record<string, string> = {};
    for (const record of ingestions) {
        record.episodeUuids.forEach((uuid, i) => {
            const evidenceId = record.evidenceIds[i];
            if (evidenceId && quotes.has(evidenceId)) episodes[uuid] = evidenceId;
        });
    }
    const present = new Set(exported.episodeUuids);
    const mapped = new Map(Object.entries(episodes).map(([uuid, eid]) => [eid, uuid]));
    const ingested: string[] = [];
    const failed: string[] = [];
    for (const item of manifest.items) {
        const uuid = mapped.get(item.id);
        (uuid && present.has(uuid) ? ingested : failed).push(item.id);
    }

    const nodes = exported.nodes.map(cleanNode).sort((a, b) => a.uuid.localeCompare(b.uuid));
    const names = new Map(nodes.map(n => [n.uuid, n.name]));
    const edges: SnapshotEdge[] = exported.edges
        .map(cleanEdge)
        .sort((a, b) => a.uuid.localeCompare(b.uuid))
        .map(edge => {
            const evidenceIds = sortEvidenceIds(
                edge.episodeUuids.map(u => episodes[u]).filter((e): e is string => !!e)
            );
            const source = names.get(edge.sourceUuid);
            const target = names.get(edge.targetUuid);
            const supported =
                !!source &&
                !!target &&
                evidenceIds.some(eid => {
                    const quote = quotes.get(eid) ?? "";
                    return mentions(quote, source) && mentions(quote, target);
                });
            return { ...edge, evidenceIds, supported };
        });

    const sameName = new Map<string, { name: string; uuids: string[] }>();
    for (const n of nodes) {
        const key = n.name.replace(/\s+/g, " ").trim().toLowerCase();
        if (!key) continue;
        const group = sameName.get(key) ?? { name: n.name, uuids: [] };
        group.uuids.push(n.uuid);
        sameName.set(key, group);
    }
    const unresolvedIdentities = [...sameName.values()]
        .filter(g => g.uuids.length > 1)
        .map(g => ({ name: g.name, uuids: [...g.uuids].sort() }))
        .sort((a, b) => a.name.localeCompare(b.name));

    const byEvidence = (a: string, b: string) => evidenceNumber(a) - evidenceNumber(b);
    const body = {
        nodes,
        edges,
        episodes,
        coverage: { ingested: ingested.sort(byEvidence), failed: failed.sort(byEvidence) },
        unresolvedIdentities,
    };
    return { ...body, graphHash: hashOf(body) };
}

export const graphFreezeStage: Stage = async ctx => {
    const { manifest, id } = await identityFor(ctx);
    const build = await ctx.artifacts.graphBuild(id.buildKey);
    if (!build) throw new Error(`Graph build ${id.buildKey.slice(0, 12)} does not exist`);
    if (build.state === "frozen") {
        const existing = await ctx.artifacts.graphSnapshot(build.id);
        if (!existing) throw new Error(`Frozen graph build ${build.id} has no snapshot`);
        return {
            output: {
                buildKey: id.buildKey,
                snapshotId: existing.id,
                graphHash: existing.data.graphHash,
                reused: true,
            },
        };
    }
    fence(ctx, build);
    const graph = requireGraph(ctx);
    const exported = await withGraph(() => graph.exportGroup(build.groupId));
    const ingestions = await ctx.artifacts.graphIngestions(build.id);
    const data = freezeGraph(exported, ingestions, manifest);
    ctx.ports.log?.("scenario graph frozen", {
        runId: ctx.run.id,
        nodes: data.nodes.length,
        edges: data.edges.length,
        supported: data.edges.filter(e => e.supported).length,
        failed: data.coverage.failed.length,
    });
    return {
        output: {
            buildKey: id.buildKey,
            graphHash: data.graphHash,
            nodes: data.nodes.length,
            edges: data.edges.length,
            supportedEdges: data.edges.filter(e => e.supported).length,
            unresolvedIdentities: data.unresolvedIdentities.length,
            reused: false,
        },
        writes: [
            { type: "graph_snapshot", buildKey: id.buildKey, data },
            buildWrite(id, build.groupId, "frozen"),
        ],
    };
};

/** The frozen snapshot a graph-mode run reads (after `graph:freeze` committed). */
export async function frozenSnapshot(ctx: StageContext) {
    const freeze = await ctx.artifacts.unitOutput<{ buildKey: string }>(unitKeys.graphFreeze);
    const { id } = await identityFor(ctx);
    const build = await ctx.artifacts.graphBuild(freeze?.buildKey ?? id.buildKey);
    if (!build || build.state !== "frozen") throw new Error("The run's graph build is not frozen");
    const snapshot = await ctx.artifacts.graphSnapshot(build.id);
    if (!snapshot) throw new Error(`Frozen graph build ${build.id} has no snapshot`);
    return { build, snapshot, ontologyHash: id.ontologyHash };
}
