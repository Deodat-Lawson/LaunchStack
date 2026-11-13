/**
 * A v2 run's work plan: the units known at acceptance, their order, their
 * dependencies and the most credits each may settle. Graph ingestion units
 * are added later by `graph:prepare`, once the manifest says how many sections
 * there are (`ingestUnits`).
 */
import { llmChatTokens } from "@launchstack/store/credits";

import type { ContextMode, RequestSpecV2, UnitPlanEntry } from "./contracts";

/** Order bands; a unit's seq is its band plus its index. */
export const SEQ = {
    sources: 1_000,
    brief: 2_000,
    ontology: 3_000,
    graphPrepare: 4_000,
    graphIngest: 5_000,
    graphFreeze: 6_000,
    castPlan: 7_000,
    actorContext: 8_000,
    castBatch: 9_000,
    worldFreeze: 10_000,
    round: 11_000,
    report: 12_000,
} as const;

/** Upper-bound tokens per call, by purpose; deliberately above the v1 estimate. */
export const UNIT_TOKEN_CAPS = {
    brief: { input: 12_000, output: 1_100 },
    ontology: { input: 9_000, output: 2_400 },
    castPlanBase: { input: 6_000, output: 400 },
    castPlanPerSlot: { input: 0, output: 90 },
    castBatchBase: { input: 3_000, output: 200 },
    castBatchPerSlot: { output: 520 },
    turn: { input: 3_000, output: 700 },
    report: { input: 9_000, output: 1_800 },
    /**
     * Graph extraction. Graphiti makes several calls per episode whose prompts
     * carry fixed instructions and the graph so far, so the cost is mostly per
     * episode, not per source token: about 8,100 input and 250 output tokens
     * an episode on a live run (13 Nov 2026). The allowance is about twice that.
     */
    ingestPerEpisode: { input: 16_000, output: 2_000 },
    ingestPerSourceToken: { input: 8, output: 2 },
} as const;

export const pad = (n: number) => String(n).padStart(2, "0");

export const unitKeys = {
    sources: "sources",
    brief: "brief",
    ontology: "ontology",
    graphPrepare: "graph:prepare",
    graphIngest: (n: number) => `graph:ingest:${pad(n)}`,
    graphFreeze: "graph:freeze",
    castPlan: "cast:plan",
    actorContext: (n: number) => `actor-context:${pad(n)}`,
    castBatch: (n: number) => `cast:batch:${pad(n)}`,
    worldFreeze: "world:freeze",
    round: (n: number) => `round:${pad(n)}`,
    report: "report",
} as const;

/** "s01" … slot ids, stable for a given agent count. */
export function slotIds(agents: number): string[] {
    return Array.from({ length: agents }, (_, i) => `s${pad(i + 1)}`);
}

/** Slot ids of cast batch `n` (1-based). */
export function batchSlots(agents: number, batchSize: number, n: number): string[] {
    return slotIds(agents).slice((n - 1) * batchSize, n * batchSize);
}

function credits(input: number, output: number, attempts = 1): number {
    return llmChatTokens(input * attempts, output * attempts);
}

export function batchCount(agents: number, batchSize: number): number {
    return Math.max(1, Math.ceil(agents / batchSize));
}

/** The plan written at acceptance. */
export function buildInitialPlan(spec: RequestSpecV2): UnitPlanEntry[] {
    const graph = spec.contextMode === "graph";
    const repairs = 1 + spec.budget.repairsPerUnit;
    const b = spec.policies.castBatchSize;
    const batches = batchCount(spec.agents, b);
    const c = UNIT_TOKEN_CAPS;
    const plan: UnitPlanEntry[] = [];
    const add = (entry: UnitPlanEntry) => plan.push(entry);

    add({
        key: unitKeys.sources,
        kind: "sources",
        seq: SEQ.sources,
        dependsOn: [],
        input: {},
        maxCredits: 0,
    });
    add({
        key: unitKeys.brief,
        kind: "brief",
        seq: SEQ.brief,
        dependsOn: [unitKeys.sources],
        input: {},
        maxCredits: credits(c.brief.input, c.brief.output, 2),
    });
    if (graph) {
        add({
            key: unitKeys.ontology,
            kind: "ontology",
            seq: SEQ.ontology,
            dependsOn: [unitKeys.sources],
            input: {},
            maxCredits: credits(c.ontology.input, c.ontology.output, repairs),
        });
        add({
            key: unitKeys.graphPrepare,
            kind: "graph_prepare",
            seq: SEQ.graphPrepare,
            dependsOn: [unitKeys.ontology],
            input: {},
            maxCredits: 0,
        });
        add({
            key: unitKeys.graphFreeze,
            kind: "graph_freeze",
            seq: SEQ.graphFreeze,
            dependsOn: [unitKeys.graphPrepare, "graph:ingest:*"],
            input: {},
            maxCredits: 0,
        });
    }
    add({
        key: unitKeys.castPlan,
        kind: "cast_plan",
        seq: SEQ.castPlan,
        dependsOn: [unitKeys.brief],
        input: { slots: spec.agents },
        maxCredits: credits(
            c.castPlanBase.input,
            c.castPlanBase.output + c.castPlanPerSlot.output * spec.agents,
            repairs
        ),
    });
    for (let n = 1; n <= batches; n++) {
        const slots = batchSlots(spec.agents, b, n);
        add({
            key: unitKeys.actorContext(n),
            kind: "actor_context",
            seq: SEQ.actorContext + n,
            dependsOn: graph ? [unitKeys.castPlan, unitKeys.graphFreeze] : [unitKeys.castPlan],
            input: { batch: n, slotIds: slots },
            maxCredits: 0,
        });
        add({
            key: unitKeys.castBatch(n),
            kind: "cast_batch",
            seq: SEQ.castBatch + n,
            dependsOn: [unitKeys.actorContext(n)],
            input: { batch: n, slotIds: slots },
            maxCredits: credits(
                c.castBatchBase.input + spec.policies.actorTokenCap * slots.length,
                c.castBatchBase.output + c.castBatchPerSlot.output * slots.length,
                repairs
            ),
        });
    }
    add({
        key: unitKeys.worldFreeze,
        kind: "world_freeze",
        seq: SEQ.worldFreeze,
        dependsOn: ["cast:batch:*"],
        input: {},
        maxCredits: 0,
    });
    for (let r = 1; r <= spec.rounds; r++) {
        add({
            key: unitKeys.round(r),
            kind: "round",
            seq: SEQ.round + r,
            dependsOn: [r === 1 ? unitKeys.worldFreeze : unitKeys.round(r - 1)],
            input: { round: r },
            maxCredits: credits(c.turn.input * spec.agents, c.turn.output * spec.agents),
        });
    }
    add({
        key: unitKeys.report,
        kind: "report",
        seq: SEQ.report,
        dependsOn: [unitKeys.round(spec.rounds)],
        input: {},
        maxCredits: credits(c.report.input, c.report.output, 2),
    });
    return plan;
}

/** `graph:ingest:NN` units for a manifest, added by `graph:prepare`. */
export function ingestUnits(
    spec: RequestSpecV2,
    evidence: Array<{ id: string; tokens: number }>
): UnitPlanEntry[] {
    const size = Math.max(1, spec.policies.ingestBatchSize);
    const c = UNIT_TOKEN_CAPS;
    const out: UnitPlanEntry[] = [];
    for (let i = 0, n = 1; i < evidence.length; i += size, n++) {
        const batch = evidence.slice(i, i + size);
        const tokens = batch.reduce((sum, e) => sum + e.tokens, 0);
        out.push({
            key: unitKeys.graphIngest(n),
            kind: "graph_ingest",
            seq: SEQ.graphIngest + n,
            dependsOn: [unitKeys.graphPrepare],
            input: { batch: n, evidenceIds: batch.map(e => e.id) },
            maxCredits: credits(
                c.ingestPerEpisode.input * batch.length + c.ingestPerSourceToken.input * tokens,
                c.ingestPerEpisode.output * batch.length + c.ingestPerSourceToken.output * tokens
            ),
        });
    }
    return out;
}

/** Sum of every unit's ceiling: the run's admitted maximum. */
export function planCeiling(plan: UnitPlanEntry[]): number {
    return plan.reduce((sum, u) => sum + u.maxCredits, 0);
}

/** Whether `key` satisfies a dependency entry (exact, or "prefix*"). */
export function matchesDependency(dep: string, key: string): boolean {
    return dep.endsWith("*") ? key.startsWith(dep.slice(0, -1)) : dep === key;
}

/** The first unit in plan order with any model work: the one acceptance reserves. */
export function firstFundedUnit(plan: UnitPlanEntry[]): UnitPlanEntry | undefined {
    return [...plan].sort((a, b) => a.seq - b.seq).find(u => u.maxCredits > 0);
}

export const DEFAULT_POLICIES = {
    actorTokenCap: 1_200,
    castBatchSize: 10,
    ingestBatchSize: 6,
} as const;

export function modeNeedsGraph(mode: ContextMode): boolean {
    return mode === "graph";
}
