/**
 * `world:freeze` — the cast becomes the starting world, frozen with the
 * hashes of everything it was built from. People take ids a1… in slot
 * order and handles are de-duplicated deterministically. The starting
 * follow graph is the engine's seeded one: relations in the evidence or the
 * graph (who works for or approves for whom) shape prompts only and never
 * become follows, so the spec claims no observed network.
 */
import { createWorld, turnSituation, type Persona } from "@launchstack/simulation";

import type { CastBatchOutput, CastMember, WorldSpecV2 } from "../contracts";
import { hashOf, stateHash } from "../hash";
import { slotIds } from "../plan";
import type { Stage } from "../stage";
import { NARRATOR, requireManifest } from "./common";
import { briefText } from "./cast-plan";
import { frozenSnapshot } from "./graph";

/** Fewer people than this and there is no simulation worth running. */
export const MIN_CAST = 3;

/** Personas in slot order with ids a1… and unique handles (first come keeps theirs). */
export function seatCast(members: CastMember[], order: string[]): Persona[] {
    const position = new Map(order.map((id, i) => [id, i]));
    const taken = new Set<string>([NARRATOR.handle.toLowerCase()]);
    return [...members]
        .sort(
            (a, b) =>
                (position.get(a.slotId) ?? Number.MAX_SAFE_INTEGER) -
                (position.get(b.slotId) ?? Number.MAX_SAFE_INTEGER)
        )
        .map((m, i) => {
            const stem = m.persona.handle.toLowerCase().replace(/\d+$/, "") || "@member";
            let handle = m.persona.handle.toLowerCase();
            for (let n = 2; taken.has(handle); n++) handle = `${stem}${n}`;
            taken.add(handle);
            return { ...m.persona, id: `a${i + 1}`, handle, slotId: m.slotId };
        });
}

export const worldFreezeStage: Stage = async ctx => {
    const manifest = await requireManifest(ctx);
    const batches = await ctx.artifacts.unitOutputs<CastBatchOutput>("cast:batch:");
    const members = batches.flatMap(b => b.output.members);
    const unfilled = batches.flatMap(b => b.output.unfilled);
    const order = slotIds(ctx.spec.agents);
    const personas = seatCast(members, order);
    const minimum = Math.min(MIN_CAST, ctx.spec.agents);
    if (personas.length < minimum)
        throw new Error(`Only ${personas.length} people could be built from the sources`);

    const { brief, text } = await briefText(ctx);
    const world = createWorld({
        subject: ctx.spec.subject,
        situation: turnSituation(ctx.spec.subject, brief),
        brief: text,
        personas,
        accounts: [NARRATOR],
        seedPosts: [
            {
                authorId: "narrator",
                text: brief && brief.openingPost.length > 0 ? brief.openingPost : ctx.spec.subject,
            },
        ],
        config: { seed: ctx.spec.seed },
    });

    const graph = ctx.mode === "graph" ? await frozenSnapshot(ctx) : null;
    const contexts = await ctx.artifacts.actorContexts();
    const seated = new Set(personas.map(p => p.slotId));
    const body: Omit<WorldSpecV2, "specHash"> = {
        version: 1,
        requestSpecHash: hashOf(ctx.spec),
        manifestHash: manifest.manifestHash,
        ontologyHash: graph?.ontologyHash ?? null,
        graphHash: graph?.snapshot.data.graphHash ?? null,
        contextMode: ctx.mode,
        contextHashes: Object.fromEntries(
            contexts
                .filter(c => seated.has(c.slotId))
                .sort((a, b) => a.slotId.localeCompare(b.slotId))
                .map(c => [c.slotId, c.contextHash])
        ),
        cast: personas.map(p => ({ slotId: p.slotId!, agentId: p.id })),
        network: { basis: "engine_seeded", follows: world.follows.length },
        initialStateHash: stateHash(world),
        versions: ctx.spec.policies.versions,
        seeds: { run: ctx.spec.seed },
    };
    const spec: WorldSpecV2 = { ...body, specHash: hashOf(body) };
    return {
        output: {
            specHash: spec.specHash,
            initialStateHash: spec.initialStateHash,
            agents: personas.length,
            unfilled,
        },
        writes: [{ type: "world_spec", spec, initialWorld: world }],
        run: { world, flags: { unfilledSlots: unfilled.length } },
    };
};
