/**
 * `cast:plan` — PlanCast. The cast is a fixed set of slots s01…sN. Code sets
 * each slot's starting stance from the realistic mix (an explicit modeling
 * assumption, REALISTIC_MIX: 35% against, 40% undecided, 25% in favour,
 * interleaved so every batch gets its share); the model proposes who fills
 * each slot and what to retrieve for them. A slot the model leaves out gets
 * a generic segment from the audience.
 */
import {
    clip,
    cleanProse,
    extractJson,
    mixCounts,
    REALISTIC_MIX,
    stripCitations,
    type Brief,
    type Stance,
    type StartingMix,
} from "@launchstack/simulation";

import type { CastPlan, CastSlot } from "../contracts";
import { slotIds, unitKeys } from "../plan";
import type { Stage, StageContext } from "../stage";
import {
    asArray,
    asRecord,
    asString,
    FALLBACK_SEGMENTS,
    requireManifest,
    SCENARIO_AUDIENCE,
} from "./common";
import { buildCastPlanRequest } from "./prompts";

/**
 * Starting stances for `n` slots: the mix's whole-person counts (largest
 * remainder, ties to the warier side), spread evenly through the slots with
 * the warier stance first on a tie, so s01 starts against. Against starts at
 * −1 and in favour at +1; strong views come from rounds.
 */
export function stanceTargets(n: number, mix: StartingMix = REALISTIC_MIX): Stance[] {
    const counts = mixCounts(n, mix);
    const groups: Array<{ stance: Stance; count: number }> = [
        { stance: -1, count: counts.against },
        { stance: 0, count: counts.undecided },
        { stance: 1, count: counts.inFavour },
    ];
    const places: Array<{ at: number; order: number; stance: Stance }> = [];
    groups.forEach((g, order) => {
        for (let k = 0; k < g.count; k++) places.push({ at: k / g.count, order, stance: g.stance });
    });
    return places.sort((a, b) => a.at - b.at || a.order - b.order).map(p => p.stance);
}

/** Segment and query per slot from a PlanCast reply; unknown or repeated slots are ignored. */
export function parseCastPlan(
    text: string,
    ids: string[]
): Map<string, { segment: string; query: string | null }> {
    const known = new Set(ids);
    const out = new Map<string, { segment: string; query: string | null }>();
    const root = asRecord(extractJson(text));
    for (const raw of asArray(root?.slots)) {
        const item = asRecord(raw);
        const slotId = (asString(item?.slotId) ?? "").trim().toLowerCase();
        if (!known.has(slotId) || out.has(slotId)) continue;
        const segment = clip(cleanProse(asString(item?.segment) ?? ""), 140);
        const query = clip(cleanProse(asString(item?.query) ?? ""), 200);
        if (!segment) continue;
        out.set(slotId, { segment, query: query.length > 0 ? query : null });
    }
    return out;
}

/** The brief as people read it (committed by `brief`). */
export async function briefText(ctx: StageContext): Promise<{ brief: Brief | null; text: string }> {
    const saved = await ctx.artifacts.unitOutput<{ brief: Brief }>(unitKeys.brief);
    const brief = saved?.brief ?? ctx.run.brief ?? null;
    return { brief, text: stripCitations(brief?.brief ?? "") };
}

export const castPlanStage: Stage = async ctx => {
    const manifest = await requireManifest(ctx);
    const { text: brief } = await briefText(ctx);
    const ids = slotIds(ctx.spec.agents);
    const targets = stanceTargets(ids.length);
    const request = buildCastPlanRequest({
        subject: ctx.spec.subject,
        audience: SCENARIO_AUDIENCE,
        brief,
        items: manifest.items,
        slots: ids.map((slotId, i) => ({ slotId, stanceTarget: targets[i]! })),
    });
    const reply = await ctx.model.complete(request);
    const proposed = parseCastPlan(reply.text, ids);
    const slots: CastSlot[] = ids.map((slotId, i) => {
        const got = proposed.get(slotId);
        const segment = got?.segment ?? FALLBACK_SEGMENTS[i % FALLBACK_SEGMENTS.length]!;
        return {
            slotId,
            segment,
            stanceTarget: targets[i]!,
            query: got?.query ?? clip(`${segment}: ${ctx.spec.subject}`, 200),
        };
    });
    const plan: CastPlan = { slots, mix: REALISTIC_MIX };
    const fallbacks = ids.length - proposed.size;
    if (fallbacks > 0)
        ctx.ports.log?.("scenario cast plan used generic segments", {
            runId: ctx.run.id,
            fallbacks,
        });
    return { output: plan };
};
