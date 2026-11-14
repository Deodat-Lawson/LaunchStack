/**
 * `actor-context:NN` — what each slot's cast call may read, assembled once
 * and saved with its hash (rounds never re-retrieve). Zero model calls.
 *
 * - passage: manifest items ranked lexically against the slot's query,
 *   segment and the subject.
 * - facts:   typed company facts first (same ranking), then passages.
 * - graph:   facts from `graph.search`, kept only when the edge is in the
 *            frozen snapshot and supported there, sorted by (score desc,
 *            uuid); their supporting passages first, then lexical passages.
 *
 * Every mode holds the context to `spec.policies.actorTokenCap`, counted the
 * same way everywhere (4 characters per token), so the cap is exact.
 */
import { clip } from "@launchstack/simulation";

import type {
    ActorContext,
    CastSlot,
    ContextFact,
    ContextMode,
    ContextPassage,
    EvidenceSnapshot,
    SnapshotEdge,
} from "../contracts";
import { approxTokens, hashOf } from "../hash";
import type { Stage } from "../stage";
import {
    focusText,
    inputStrings,
    lexicalScorer,
    requireCastPlan,
    requireGraph,
    requireManifest,
    sortEvidenceIds,
    withGraph,
} from "./common";
import { frozenSnapshot } from "./graph";

/** Longest single passage in a context, before the cap. */
export const PASSAGE_MAX_TOKENS = 400;
/** A passage shorter than this is not worth the space. */
const PASSAGE_MIN_TOKENS = 30;
/** Most facts in one context. */
export const MAX_CONTEXT_FACTS = 12;
const FACT_MAX_CHARS = 320;
/** Hits asked of the graph per slot. */
export const GRAPH_SEARCH_LIMIT = 20;

export interface ActorContextInput {
    slot: CastSlot;
    subject: string;
    items: EvidenceSnapshot[];
    mode: ContextMode;
    cap: number;
    policyVersion: string;
    /** Graph mode: supported snapshot edges, already ranked, and the snapshot id. */
    graph?: { snapshotId: number; edges: SnapshotEdge[] };
}

function ranked(
    items: EvidenceSnapshot[],
    query: string,
    score: (q: string, t: string) => number
): EvidenceSnapshot[] {
    return items
        .map((item, i) => ({ item, i, s: score(query, `${item.label} ${item.quote}`) }))
        .sort((a, b) => b.s - a.s || a.i - b.i)
        .map(x => x.item);
}

/** Assemble one slot's context. Pure. */
export function buildActorContext(input: ActorContextInput): ActorContext {
    const { slot, items, cap } = input;
    const query = `${slot.query} ${slot.segment} ${input.subject}`;
    const score = lexicalScorer(items.map(i => `${i.label} ${i.quote}`));
    const byId = new Map(items.map(i => [i.id, i]));
    let used = 0;
    const facts: ContextFact[] = [];
    const passages: ContextPassage[] = [];
    const inContext = new Set<string>();
    const edgeIds: string[] = [];
    const nodeIds = new Set<string>();

    const addFact = (fact: ContextFact): boolean => {
        if (facts.length >= MAX_CONTEXT_FACTS) return false;
        const cost = approxTokens(fact.text);
        if (used + cost > cap) return false;
        facts.push(fact);
        used += cost;
        return true;
    };
    const addPassage = (item: EvidenceSnapshot): void => {
        if (inContext.has(item.id)) return;
        const room = Math.min(PASSAGE_MAX_TOKENS, cap - used);
        if (room < PASSAGE_MIN_TOKENS) return;
        const text = focusText(item.quote, query, room * 4);
        const cost = approxTokens(text);
        if (!text || used + cost > cap) return;
        passages.push({ evidenceId: item.id, text });
        inContext.add(item.id);
        used += cost;
    };

    if (input.mode === "graph" && input.graph) {
        for (const edge of input.graph.edges) {
            const ok = addFact({
                id: edge.uuid,
                text: clip(edge.fact, FACT_MAX_CHARS),
                evidenceIds: edge.evidenceIds,
            });
            if (!ok) continue;
            edgeIds.push(edge.uuid);
            nodeIds.add(edge.sourceUuid);
            nodeIds.add(edge.targetUuid);
        }
        // The passages behind the facts come before anything lexical.
        for (const fact of facts)
            for (const eid of fact.evidenceIds) {
                const item = byId.get(eid);
                if (item) addPassage(item);
            }
    }
    const typed = items.filter(i => i.fact);
    if (input.mode === "facts") {
        for (const item of ranked(typed, query, score))
            addFact({
                id: `fact:${item.fact!.key}`,
                text: clip(item.quote, FACT_MAX_CHARS),
                evidenceIds: [item.id],
            });
    }
    const passageItems = input.mode === "facts" ? items.filter(i => !i.fact) : items;
    for (const item of ranked(passageItems, query, score)) addPassage(item);

    const evidenceIds = sortEvidenceIds([
        ...passages.map(p => p.evidenceId),
        ...facts.flatMap(f => f.evidenceIds),
    ]);
    const body: Omit<ActorContext, "contextHash"> = {
        slotId: slot.slotId,
        segment: slot.segment,
        mode: input.mode,
        graphSnapshotId: input.mode === "graph" ? (input.graph?.snapshotId ?? null) : null,
        selected: { nodeIds: [...nodeIds].sort(), edgeIds, evidenceIds },
        facts,
        passages,
        retrievalPolicyVersion: input.policyVersion,
        tokens: used,
    };
    return { ...body, contextHash: hashOf(body) };
}

/** Search hits kept for a slot: present and supported in the snapshot, (score desc, uuid). */
export function supportedHits(
    hits: Array<{ edge: { uuid: string }; score: number }>,
    snapshotEdges: SnapshotEdge[]
): SnapshotEdge[] {
    const frozen = new Map(snapshotEdges.map(e => [e.uuid, e]));
    const best = new Map<string, number>();
    for (const hit of hits) {
        const edge = frozen.get(hit.edge.uuid);
        if (!edge?.supported) continue;
        const s = Number.isFinite(hit.score) ? hit.score : 0;
        best.set(edge.uuid, Math.max(best.get(edge.uuid) ?? -Infinity, s));
    }
    return [...best]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([uuid]) => frozen.get(uuid)!);
}

export const actorContextStage: Stage = async ctx => {
    const ids = inputStrings(ctx, "slotIds");
    const plan = await requireCastPlan(ctx);
    const manifest = await requireManifest(ctx);
    const slots = ids.map(id => {
        const slot = plan.slots.find(s => s.slotId === id);
        if (!slot) throw new Error(`Slot ${id} is not in the cast plan`);
        return slot;
    });

    const graphMode = ctx.mode === "graph";
    const frozen = graphMode ? await frozenSnapshot(ctx) : null;
    const graph = graphMode ? requireGraph(ctx) : null;
    const contexts: ActorContext[] = [];
    for (const slot of slots) {
        let edges: SnapshotEdge[] | undefined;
        if (graph && frozen) {
            const hits = await withGraph(() =>
                graph.search({
                    groupId: frozen.build.groupId,
                    query: slot.query,
                    limit: GRAPH_SEARCH_LIMIT,
                })
            );
            edges = supportedHits(hits, frozen.snapshot.data.edges);
        }
        contexts.push(
            buildActorContext({
                slot,
                subject: ctx.spec.subject,
                items: manifest.items,
                mode: ctx.mode,
                cap: ctx.spec.policies.actorTokenCap,
                policyVersion: ctx.spec.policies.versions.retrievalPolicy,
                ...(frozen && edges ? { graph: { snapshotId: frozen.snapshot.id, edges } } : {}),
            })
        );
    }
    return {
        output: {
            slotIds: ids,
            contextHashes: Object.fromEntries(contexts.map(c => [c.slotId, c.contextHash])),
            tokens: Object.fromEntries(contexts.map(c => [c.slotId, c.tokens])),
        },
        writes: [{ type: "actor_contexts", contexts }],
    };
};
