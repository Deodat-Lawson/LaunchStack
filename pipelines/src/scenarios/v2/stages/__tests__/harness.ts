/**
 * Test doubles for the generation stages: a request spec and run, an
 * in-memory ArtifactReader that applies a stage's writes the way the store
 * would (jsonb round-trip included), a fake Graphiti port, a scripted model
 * and a tiny sequential engine that runs a whole plan.
 */
import {
    tokenize,
    type ModelReply,
    type ModelRequest,
    type SimulationModel,
} from "@launchstack/simulation";

import type { ScenarioRunRecord } from "../../../types";
import {
    DEFAULT_SOURCE_BUDGET,
    GraphUnavailableError,
    V2_VERSIONS,
    type ActorContext,
    type GraphEdge,
    type GraphEpisodeInput,
    type GraphNode,
    type OntologySpec,
    type RequestSpecV2,
    type RoundCheckpoint,
    type ScenarioGraphPort,
    type SourceManifest,
    type UnitPlanEntry,
    type UnitRecord,
} from "../../contracts";
import { buildInitialPlan, DEFAULT_POLICIES, matchesDependency } from "../../plan";
import type {
    ArtifactReader,
    ArtifactWrite,
    GraphBuildRecord,
    GraphIngestionRecord,
    GraphSnapshotRecord,
    SourceCollection,
    SourceSectionDraft,
    Stage,
    StageContext,
    StageResult,
    WorldSpecRecord,
} from "../../stage";
import { V2_STAGES } from "../index";

/** What jsonb does to a value: drops undefined, keeps JSON. */
export const jsonb = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function makeSpec(overrides: Partial<RequestSpecV2> = {}): RequestSpecV2 {
    const contextMode = overrides.contextMode ?? "passage";
    return {
        contractVersion: 2,
        kind: "scenario",
        title: "Northwind renewal",
        subject: "Acme asks Northwind to move from Acme Legacy to Acme Cloud at renewal.",
        agents: 4,
        rounds: 2,
        seed: 17,
        sources: {
            documentIds: [7, 8],
            searchFiles: false,
            prospects: false,
            brandComments: false,
            companyProfile: false,
            notes: "",
        },
        contextMode,
        requestedContextMode: contextMode,
        fallbackReason: null,
        budget: { maxCredits: 1_000_000, repairsPerUnit: 1 },
        policies: {
            versions: V2_VERSIONS,
            actorTokenCap: DEFAULT_POLICIES.actorTokenCap,
            sourceBudget: DEFAULT_SOURCE_BUDGET,
            castBatchSize: DEFAULT_POLICIES.castBatchSize,
            ingestBatchSize: DEFAULT_POLICIES.ingestBatchSize,
        },
        ...overrides,
    };
}

export function makeRun(overrides: Partial<ScenarioRunRecord> = {}): ScenarioRunRecord {
    return {
        id: 41,
        companyId: 5n,
        createdByUserId: "creator",
        kind: "scenario",
        title: "Northwind renewal",
        subject: makeSpec().subject,
        status: "running",
        step: 0,
        agentCount: 4,
        roundCount: 2,
        seed: 17,
        sources: makeSpec().sources,
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
        createdAt: new Date("2026-11-12T00:00:00Z"),
        startedAt: new Date("2026-11-12T00:00:00Z"),
        finishedAt: null,
        eventsClosedAt: null,
        contractVersion: 2,
        requestSpecId: 1,
        worldSpecId: null,
        generation: 1,
        leaseOwner: "test",
        leaseEpoch: 1,
        contextMode: "passage",
        flags: null,
        ...overrides,
    };
}

// ─── Evidence fixtures (design §3.4 / §7.1) ──────────────────────────────────

export const E1_TEXT = "Maya recommends Northwind's software purchases; Lee approves them.";
export const E2_TEXT =
    "Northwind uses Acme Legacy. Migration requires approximately fourteen days.";

export function section(
    overrides: Partial<SourceSectionDraft> & Pick<SourceSectionDraft, "text">
): SourceSectionDraft {
    const documentId = overrides.locator?.documentId ?? 7;
    return {
        kind: "document",
        sourceType: "document",
        sourceId: String(documentId),
        versionId: "3",
        label: "contacts.pdf, page 2",
        locator: {
            documentId,
            versionId: 3,
            chunkId: 100,
            page: 2,
            section: null,
            providerId: null,
        },
        fact: null,
        validity: "versioned",
        documentIds: [documentId],
        href: `/employer/documents?docId=${documentId}`,
        score: 1,
        ...overrides,
    };
}

/** contacts.pdf v3 p2 (E1) and renewal.pdf v5 p4 (E2). */
export function groundingCollection(): SourceCollection {
    return {
        sections: [
            section({ text: E1_TEXT }),
            section({
                text: E2_TEXT,
                sourceId: "8",
                versionId: "5",
                label: "renewal.pdf, page 4",
                locator: {
                    documentId: 8,
                    versionId: 5,
                    chunkId: 200,
                    page: 4,
                    section: "Renewal terms",
                    providerId: null,
                },
                documentIds: [8],
                href: "/employer/documents?docId=8",
                score: 0.9,
            }),
        ],
        omissions: [],
    };
}

// ─── In-memory artifacts ─────────────────────────────────────────────────────

export class MemoryArtifacts implements ArtifactReader {
    outputs = new Map<string, unknown>();
    manifest: SourceManifest | undefined;
    ontology: (OntologySpec & { id: number }) | undefined;
    builds = new Map<string, GraphBuildRecord>();
    ingestions: GraphIngestionRecord[] = [];
    snapshots = new Map<number, GraphSnapshotRecord>();
    contexts = new Map<string, ActorContext>();
    world: WorldSpecRecord | undefined;
    saved: RoundCheckpoint[] = [];
    injections: Array<{ id: number; text: string; appliedRound: number | null }> = [];
    /** Calls in order, to check the final round closes events before reading them. */
    log: string[] = [];
    private nextId = 1;

    async unitOutput<T>(key: string) {
        return this.outputs.get(key) as T | undefined;
    }
    async unitOutputs<T>(prefix: string) {
        return [...this.outputs]
            .filter(([k]) => k.startsWith(prefix))
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, output]) => ({ key, output: output as T }));
    }
    async sourceManifest() {
        return this.manifest;
    }
    async ontologySpec() {
        return this.ontology;
    }
    async graphBuild(key: string) {
        const b = this.builds.get(key);
        return b ? { ...b } : undefined;
    }
    async graphBuildById(id: number) {
        return [...this.builds.values()].find(b => b.id === id);
    }
    async graphIngestions(buildId: number) {
        return this.ingestions.filter(i => i.buildId === buildId);
    }
    async graphSnapshot(buildId: number) {
        return this.snapshots.get(buildId);
    }
    async actorContexts() {
        return [...this.contexts.values()];
    }
    async worldSpec() {
        return this.world;
    }
    async checkpoints() {
        return [...this.saved];
    }
    async pendingInjections() {
        this.log.push("pendingInjections");
        return this.injections
            .filter(i => i.appliedRound === null)
            .map(({ id, text }) => ({ id, text }));
    }

    /** Apply a committed stage result as the store would. */
    apply(run: ScenarioRunRecord, unitKey: string, result: StageResult): void {
        for (const raw of result.writes ?? []) this.write(run, jsonb(raw));
        this.outputs.set(unitKey, jsonb(result.output));
        const patch = result.run;
        if (patch) {
            if (patch.evidence) run.evidence = jsonb(patch.evidence);
            if (patch.brief) run.brief = jsonb(patch.brief);
            if (patch.world) run.world = jsonb(patch.world);
            if (patch.report) run.report = jsonb(patch.report);
            if (patch.status) run.status = patch.status;
            if (patch.finishedAt) run.finishedAt = patch.finishedAt;
            if (patch.flags) run.flags = { ...(run.flags ?? ({} as never)), ...jsonb(patch.flags) };
        }
    }

    private write(run: ScenarioRunRecord, w: ArtifactWrite): void {
        switch (w.type) {
            case "source_manifest":
                this.manifest = w.manifest;
                return;
            case "ontology_spec":
                this.ontology = { ...w.spec, id: this.nextId++ };
                return;
            case "graph_build": {
                const existing = this.builds.get(w.buildKey);
                if (!existing) {
                    this.builds.set(w.buildKey, {
                        id: this.nextId++,
                        companyId: run.companyId,
                        buildKey: w.buildKey,
                        groupId: w.groupId,
                        state: w.state,
                        ownerRunId: run.id,
                        ownerEpoch: 1,
                        manifestHash: w.manifestHash,
                        ontologyHash: w.ontologyHash,
                        policyVersion: w.policyVersion,
                        snapshotId: null,
                        error: w.error ?? null,
                    });
                    return;
                }
                if (existing.ownerRunId !== run.id) {
                    if (!w.takeOver) throw new Error("graph build owned by another run");
                    existing.ownerRunId = run.id;
                    existing.ownerEpoch += 1;
                }
                existing.state = w.state;
                existing.error = w.error ?? null;
                return;
            }
            case "graph_ingestion": {
                const build = this.builds.get(w.buildKey)!;
                this.ingestions = this.ingestions.filter(
                    i => !(i.buildId === build.id && i.unitKey === w.unitKey)
                );
                this.ingestions.push({
                    id: this.nextId++,
                    buildId: build.id,
                    unitKey: w.unitKey,
                    evidenceIds: w.evidenceIds,
                    episodeUuids: w.episodeUuids,
                    status: w.status,
                    attempts: 1,
                    error: w.error ?? null,
                });
                return;
            }
            case "graph_snapshot": {
                const build = this.builds.get(w.buildKey)!;
                const id = this.nextId++;
                this.snapshots.set(build.id, { id, buildId: build.id, data: w.data });
                build.snapshotId = id;
                return;
            }
            case "actor_contexts":
                for (const c of w.contexts) this.contexts.set(c.slotId, c);
                return;
            case "world_spec":
                this.world = { id: this.nextId++, spec: w.spec, initialWorld: w.initialWorld };
                return;
            case "checkpoint":
                this.saved.push(w.checkpoint);
                for (const i of this.injections)
                    if (w.appliedInjectionIds.includes(i.id)) i.appliedRound = w.checkpoint.round;
                return;
        }
    }
}

// ─── Fake graph ──────────────────────────────────────────────────────────────

export interface Extraction {
    nodes: Array<Omit<GraphNode, "summary" | "attributes"> & Partial<GraphNode>>;
    edges: Array<Omit<GraphEdge, "episodeUuids" | "validAt" | "invalidAt" | "attributes">>;
}

/**
 * A Graphiti stand-in. `extract` decides what each episode yields; nodes and
 * edges are keyed by uuid, so the same node from two episodes is one node
 * and an edge remembers every episode it came from.
 */
export function fakeGraph(extract: (episode: GraphEpisodeInput) => Extraction) {
    const groups = new Map<
        string,
        {
            episodes: Map<string, GraphEpisodeInput>;
            nodes: Map<string, GraphNode>;
            edges: Map<string, GraphEdge>;
        }
    >();
    const group = (id: string) => {
        let g = groups.get(id);
        if (!g) {
            g = { episodes: new Map(), nodes: new Map(), edges: new Map() };
            groups.set(id, g);
        }
        return g;
    };
    const calls = { ingest: 0, submitted: [] as string[], search: 0, export: 0 };
    const state = { up: true };
    const check = () => {
        if (!state.up) throw new GraphUnavailableError();
    };
    const port: ScenarioGraphPort = {
        async health() {
            return { ok: state.up, graphiti: "test", neo4j: "test" };
        },
        async ingest({ groupId, episodes }) {
            check();
            calls.ingest += 1;
            const g = group(groupId);
            for (const e of episodes) {
                calls.submitted.push(e.evidenceId);
                g.episodes.set(e.uuid, e);
                const out = extract(e);
                for (const n of out.nodes)
                    g.nodes.set(n.uuid, { summary: "", attributes: {}, ...n } as GraphNode);
                for (const edge of out.edges) {
                    const prev = g.edges.get(edge.uuid);
                    g.edges.set(edge.uuid, {
                        validAt: null,
                        invalidAt: null,
                        attributes: {},
                        ...edge,
                        episodeUuids: [...new Set([...(prev?.episodeUuids ?? []), e.uuid])],
                    });
                }
            }
            return {
                outcomes: episodes.map(e => ({ uuid: e.uuid, status: "done" as const })),
                usage: {
                    calls: episodes.length * 3,
                    inputTokens: 900 * episodes.length,
                    outputTokens: 200 * episodes.length,
                    embeddingTokens: 50 * episodes.length,
                },
            };
        },
        async listEpisodes(groupId) {
            check();
            return [...group(groupId).episodes.keys()];
        },
        async search({ groupId, query, limit }) {
            check();
            calls.search += 1;
            const want = new Set(tokenize(query));
            return [...group(groupId).edges.values()]
                .map(edge => ({
                    edge,
                    score: tokenize(edge.fact).filter(t => want.has(t)).length,
                }))
                .filter(h => h.score > 0)
                .slice(0, limit);
        },
        async exportGroup(groupId) {
            check();
            calls.export += 1;
            const g = group(groupId);
            return {
                nodes: [...g.nodes.values()],
                edges: [...g.edges.values()],
                episodeUuids: [...g.episodes.keys()],
            };
        },
        async deleteGroup(groupId) {
            groups.delete(groupId);
        },
    };
    return { port, calls, state, groups };
}

/** What the fixtures' two passages yield, Graphiti-style. */
export function groundingExtraction(episode: GraphEpisodeInput): Extraction {
    const body = episode.body;
    if (body.includes("Maya recommends")) {
        return {
            nodes: [
                { uuid: "n-maya", name: "Maya", labels: ["Entity", "Person"] },
                { uuid: "n-lee-1", name: "Lee", labels: ["Entity", "Person"] },
                { uuid: "n-northwind", name: "Northwind", labels: ["Entity", "Organization"] },
                {
                    uuid: "n-purchases",
                    name: "software purchases",
                    labels: ["Entity", "PurchaseDecision"],
                },
            ],
            edges: [
                {
                    uuid: "e-maya-influences",
                    name: "INFLUENCES",
                    fact: "Maya recommends Northwind's software purchases.",
                    sourceUuid: "n-maya",
                    targetUuid: "n-purchases",
                },
                {
                    uuid: "e-lee-approves",
                    name: "APPROVES",
                    fact: "Lee approves Northwind's software purchases.",
                    sourceUuid: "n-lee-1",
                    targetUuid: "n-purchases",
                },
                {
                    uuid: "e-maya-works-for",
                    name: "WORKS_FOR",
                    fact: "Maya works for Northwind and recommends its software.",
                    sourceUuid: "n-maya",
                    targetUuid: "n-northwind",
                },
            ],
        };
    }
    if (body.includes("Acme Legacy")) {
        return {
            nodes: [
                { uuid: "n-northwind", name: "Northwind", labels: ["Entity", "Organization"] },
                { uuid: "n-legacy", name: "Acme Legacy", labels: ["Entity", "Product"] },
                { uuid: "n-maya", name: "Maya", labels: ["Entity", "Person"] },
            ],
            edges: [
                {
                    uuid: "e-northwind-uses",
                    name: "USES",
                    fact: "Northwind uses Acme Legacy software; migration takes about fourteen days.",
                    sourceUuid: "n-northwind",
                    targetUuid: "n-legacy",
                },
                // Graphiti joined two passages: the passage it came from never names Maya.
                {
                    uuid: "e-maya-uses",
                    name: "USES",
                    fact: "Maya uses Acme Legacy software every day.",
                    sourceUuid: "n-maya",
                    targetUuid: "n-legacy",
                },
            ],
        };
    }
    if (body.includes("Lee from Contoso")) {
        return {
            nodes: [{ uuid: "n-lee-2", name: "Lee", labels: ["Entity", "Person"] }],
            edges: [],
        };
    }
    return { nodes: [], edges: [] };
}

// ─── Scripted model ──────────────────────────────────────────────────────────

export type Script = (request: ModelRequest) => unknown;

export function scriptedModel(script: Script): SimulationModel & { requests: ModelRequest[] } {
    const requests: ModelRequest[] = [];
    return {
        requests,
        async complete(request): Promise<ModelReply> {
            requests.push(request);
            const out = script(request);
            if (out instanceof Error) throw out;
            return {
                text: typeof out === "string" ? out : JSON.stringify(out),
                usage: { inputTokens: 100, outputTokens: 20 },
            };
        },
    };
}

/** Slot ids and the evidence ids each slot block shows, from a cast_v2 prompt. */
export function slotBlocks(prompt: string): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const block of prompt.split(/^## Slot /m).slice(1)) {
        const slotId = /^(s\d+)/.exec(block)?.[1];
        if (!slotId) continue;
        const body = block.split(/^Return one member/m)[0] ?? block;
        out.set(slotId, [...new Set([...body.matchAll(/\b(E\d+)\b/g)].map(m => m[1]!))]);
    }
    return out;
}

const unknownField = { value: null, basis: "unknown", evidenceIds: [], explanation: null };

/** The fixture's operations person, grounded as the design describes. */
export function operationsMember(slotId: string, ids: string[]) {
    const hasE1 = ids.includes("E1");
    const hasE2 = ids.includes("E2");
    return {
        slotId,
        name: "Jordan Avery",
        handle: `@jordan_${slotId}`,
        bio: "Runs operations at a mid-size distributor. Keeps the systems running.",
        interests: ["operations", "renewals", "uptime"],
        activity: 0.4,
        influence: 0.3,
        role: hasE1
            ? {
                  value: "Operations lead who recommends software purchases",
                  basis: "inferred",
                  evidenceIds: ["E1"],
                  explanation: "The evidence says operations staff recommend purchases.",
              }
            : {
                  value: "Operations lead",
                  basis: "assumed",
                  evidenceIds: [],
                  explanation: "The slot is an operations seat.",
              },
        currentSolution: hasE2
            ? { value: "Acme Legacy", basis: "source", evidenceIds: ["E2"], explanation: null }
            : unknownField,
        budget: unknownField,
        buyingRole: hasE1
            ? { value: "influences", basis: "source", evidenceIds: ["E1"], explanation: null }
            : unknownField,
        switchingCost: hasE2
            ? {
                  value: "high",
                  basis: "inferred",
                  evidenceIds: ["E2"],
                  explanation: "A migration of approximately fourteen days is a large switch.",
              }
            : unknownField,
        objection: {
            value: "Two weeks of migration in renewal season is a lot to ask.",
            basis: "assumed",
            evidenceIds: [],
            explanation: "Follows from the slot's starting stance.",
        },
    };
}

const FIRST_NAMES = ["Jordan", "Riley", "Casey", "Morgan", "Avery", "Quinn", "Rowan", "Sage"];

/**
 * A deterministic model for a whole run: every purpose answers from the
 * request alone, so a replayed request gets the reply it got the first time.
 */
export const runScript: Script = request => {
    switch (request.purpose) {
        case "brief":
            return {
                brief: "Northwind runs Acme Legacy [E2]. Maya recommends its software purchases and Lee approves them [E1].",
                openingPost:
                    "Acme tells Northwind its Legacy contract will move to Acme Cloud at renewal.",
                situation: "",
                evidenceIds: ["E1", "E2"],
            };
        case "ontology":
            return {
                entities: [
                    {
                        name: "MigrationProject",
                        description: "A planned move from one product to another.",
                        attributes: [
                            {
                                name: "duration",
                                type: "string",
                                description: "How long it takes, as stated.",
                            },
                        ],
                        motivatingEvidenceId: "E2",
                    },
                ],
                edges: [
                    {
                        name: "MIGRATES_FROM",
                        description: "An organization plans to move off a product.",
                        attributes: [],
                        endpoints: [{ source: "Organization", target: "Product" }],
                        motivatingEvidenceId: "E2",
                    },
                ],
            };
        case "cast_plan": {
            const ids = [...request.prompt.matchAll(/^(s\d+):/gm)].map(m => m[1]!);
            return {
                slots: ids.map(slotId => ({
                    slotId,
                    segment: `operations lead at a mid-size customer (${slotId})`,
                    query: "operations software purchases migration Acme Legacy approves",
                })),
            };
        }
        case "cast_v2":
            return {
                members: [...slotBlocks(request.prompt)].map(([slotId, ids], i) => ({
                    ...operationsMember(slotId, ids),
                    name: `${FIRST_NAMES[Number(slotId.slice(1)) % FIRST_NAMES.length]} Okafor-${i}`,
                })),
            };
        case "decide": {
            const feed = [...request.prompt.matchAll(/^\[(p\d+)\]/gm)].map(m => m[1]!);
            const round = Number(/^Round (\d+)\./m.exec(request.prompt)?.[1] ?? 0);
            const handle = /\((@[a-z0-9_]+)\)\./.exec(request.system)?.[1] ?? "@x";
            const skeptic = handle.endsWith("1");
            return {
                thought: `${handle} weighs the migration in round ${round}.`,
                stance: skeptic ? -2 : 1,
                convincedBy: skeptic ? null : (feed[0] ?? null),
                wouldPay: skeptic ? "no" : "maybe",
                objection: skeptic ? "Fourteen days of migration." : null,
                actions: [
                    ...(feed[0]
                        ? [{ type: "like", postId: feed[0], text: null, handle: null }]
                        : []),
                    ...(round === 1
                        ? [
                              {
                                  type: "create_post",
                                  postId: null,
                                  text: `${handle}: what would the move cost us?`,
                                  handle: null,
                              },
                          ]
                        : []),
                ],
            };
        }
        case "report":
            return {
                headline: "Operations leads resist a rushed migration",
                summary: "Most people held their view; the migration time dominated.",
                dynamics: [],
                turningPoints: [],
                factions: [],
                watchFor: ["Migration time"],
            };
        default:
            return {};
    }
};

// ─── A sequential engine ─────────────────────────────────────────────────────

export interface Harness {
    run: ScenarioRunRecord;
    spec: RequestSpecV2;
    artifacts: MemoryArtifacts;
    model: SimulationModel & { requests: ModelRequest[] };
    graph: ScenarioGraphPort | null;
    collection: SourceCollection;
    plan: UnitPlanEntry[];
    committed: Set<string>;
}

export function makeHarness(
    options: {
        spec?: Partial<RequestSpecV2>;
        run?: Partial<ScenarioRunRecord>;
        script?: Script;
        graph?: ScenarioGraphPort | null;
        collection?: SourceCollection;
        artifacts?: MemoryArtifacts;
    } = {}
): Harness {
    const spec = makeSpec(options.spec);
    return {
        run: makeRun({ contextMode: spec.contextMode, ...options.run }),
        spec,
        artifacts: options.artifacts ?? new MemoryArtifacts(),
        model: scriptedModel(options.script ?? runScript),
        graph: options.graph ?? null,
        collection: options.collection ?? groundingCollection(),
        plan: buildInitialPlan(spec),
        committed: new Set(),
    };
}

export function unitFor(entry: UnitPlanEntry, runId = 41): UnitRecord {
    return {
        ...entry,
        id: entry.seq,
        runId,
        generation: 1,
        status: "running",
        attempts: 1,
        inputHash: "",
        output: null,
        usage: { calls: 0, inputTokens: 0, outputTokens: 0 },
        credits: 0,
        startedAt: new Date("2026-11-12T00:00:00Z"),
        committedAt: null,
        error: null,
    };
}

export function contextFor(
    h: Harness,
    entry: UnitPlanEntry,
    overrides: Partial<StageContext> = {}
): StageContext {
    return {
        run: h.run,
        spec: h.spec,
        mode: h.spec.contextMode,
        unit: unitFor(entry, h.run.id),
        model: h.model,
        artifacts: h.artifacts,
        ports: {
            collectSources: async () => structuredClone(h.collection),
            graph: h.graph,
            now: () => new Date("2026-11-12T09:30:00Z"),
        },
        concurrency: 3,
        closeEvents: async () => {
            h.artifacts.log.push("closeEvents");
            h.run.eventsClosedAt ??= new Date("2026-11-12T10:00:00Z");
        },
        ...overrides,
    };
}

/** Run one unit by key and commit it. */
export async function runUnit(h: Harness, key: string, stage?: Stage): Promise<StageResult> {
    const entry = h.plan.find(u => u.key === key);
    if (!entry) throw new Error(`No unit ${key} in the plan`);
    const result = await (stage ?? V2_STAGES[entry.kind])(contextFor(h, entry));
    h.artifacts.apply(h.run, key, result);
    h.committed.add(key);
    for (const f of result.followUps ?? []) if (!h.plan.some(u => u.key === f.key)) h.plan.push(f);
    return result;
}

/** Run every unit in plan order, honouring dependencies and follow-ups. */
export async function runAll(h: Harness, until?: string): Promise<void> {
    for (;;) {
        const ready = h.plan
            .filter(u => !h.committed.has(u.key))
            .filter(u =>
                u.dependsOn.every(dep =>
                    dep.endsWith("*")
                        ? h.plan
                              .filter(p => matchesDependency(dep, p.key))
                              .every(p => h.committed.has(p.key))
                        : h.committed.has(dep)
                )
            )
            .sort((a, b) => a.seq - b.seq);
        const next = ready[0];
        if (!next) return;
        await runUnit(h, next.key);
        if (next.key === until) return;
    }
}
