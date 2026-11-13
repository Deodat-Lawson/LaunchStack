/**
 * `cast:batch:NN` — GenerateCastBatch. One call writes every slot in the
 * batch, each from its own context block, and every wallet field comes back
 * with a basis and the evidence behind it. Code validates each slot against
 * its own context: `source` and `inferred` must cite evidence that slot was
 * shown, `inferred` and `assumed` must say why, `unknown` carries no value,
 * enum fields must be valid, and the name must not be lifted from the
 * evidence. Valid slots are kept; only missing or invalid ones go back to the
 * model, within the repair allowance. When the allowance runs out, a field
 * whose only fault is a missing reason becomes unknown (the claim is dropped,
 * never given an invented reason) and the person is kept; a slot with any
 * other fault (a citation outside its evidence, a bad value, a lifted name)
 * is listed as unfilled.
 *
 * The persona's stance is the slot's target, never the model's. Its wallet
 * comes from the attributed values (an unknown value leaves the field unset).
 * Source entity ids stay internal: the people shown are fictional composites.
 */
import {
    BUDGETS,
    BUYING_ROLES,
    clip,
    cleanProse,
    extractJson,
    SWITCHING_COSTS,
    tokenize,
    type Persona,
} from "@launchstack/simulation";

import {
    ATTRIBUTED_FIELDS,
    BASES,
    type ActorContext,
    type Attributed,
    type AttributedField,
    type Basis,
    type CastBatchOutput,
    type CastMember,
    type CastSlot,
} from "../contracts";
import { slotIds } from "../plan";
import type { Stage } from "../stage";
import {
    asArray,
    asNumber,
    asRecord,
    asString,
    inputStrings,
    requireCastPlan,
    sortEvidenceIds,
} from "./common";
import { briefText } from "./cast-plan";
import { buildCastBatchRequest, buildCastRepairRequest } from "./prompts";

const ENUMS: Partial<Record<AttributedField, readonly string[]>> = {
    budget: BUDGETS,
    buyingRole: BUYING_ROLES,
    switchingCost: SWITCHING_COSTS,
};
const VALUE_CHARS: Record<AttributedField, number> = {
    role: 140,
    currentSolution: 80,
    budget: 20,
    buyingRole: 20,
    switchingCost: 20,
    objection: 200,
};
/** Most facts a persona carries into its turns (see Persona.knows). */
const KNOWS_MAX = 5;

export interface MemberValidation {
    member?: CastMember;
    errors: string[];
    /** Fields made unknown on the last pass for want of a reason. */
    dropped?: AttributedField[];
}

function slugHandle(raw: string, fallbackName: string): string {
    const base = (raw || fallbackName)
        .toLowerCase()
        .replace(/^@+/, "")
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 20);
    return `@${base || "member"}`;
}

/** Name parts (3+ letters) that appear, capitalised as written, in the slot's evidence. */
function namesFromEvidence(name: string, context: ActorContext): string[] {
    const corpus = [...context.facts.map(f => f.text), ...context.passages.map(p => p.text)].join(
        "\n"
    );
    return name
        .split(/[\s\-']+/)
        .filter(part => part.length >= 3)
        .filter(part => {
            const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u").test(corpus);
        });
}

function readValue(raw: unknown, field: AttributedField): string | null {
    const text = clip(cleanProse(asString(raw) ?? ""), VALUE_CHARS[field]);
    if (!text || /^(null|none|unknown|n\/a)$/i.test(text)) return null;
    return ENUMS[field] ? text.toLowerCase() : text;
}

function readAttributed(
    raw: unknown,
    field: AttributedField,
    allowed: Set<string>,
    slotId: string,
    errors: string[],
    /** Set on the last pass: an unexplained inference or assumption becomes unknown and is listed here. */
    dropped?: AttributedField[]
): Attributed<string> {
    const unknown: Attributed<string> = { value: null, basis: "unknown", evidenceIds: [] };
    const a = asRecord(raw);
    if (!a) {
        errors.push(`${field} is missing.`);
        return unknown;
    }
    const basis = (asString(a.basis) ?? "").trim().toLowerCase() as Basis;
    if (!BASES.includes(basis)) {
        errors.push(`${field} has basis "${basis}"; use source, inferred, assumed or unknown.`);
        return unknown;
    }
    if (basis === "unknown") return unknown;

    const explanation = clip(cleanProse(asString(a.explanation) ?? ""), 240);
    if (dropped && (basis === "inferred" || basis === "assumed") && !explanation) {
        dropped.push(field);
        return unknown;
    }
    const value = readValue(a.value, field);
    const ids = [
        ...new Set(
            asArray(a.evidenceIds)
                .map(v => (asString(v) ?? "").trim().toUpperCase())
                .filter(Boolean)
        ),
    ];
    const options = ENUMS[field];
    if (!value) errors.push(`${field} is ${basis} but has no value; use basis "unknown" instead.`);
    else if (options && !options.includes(value))
        errors.push(`${field} is "${value}"; it must be one of ${options.join(", ")}.`);

    if (basis === "source" || basis === "inferred") {
        if (ids.length === 0) errors.push(`${field} is ${basis} but cites no evidence.`);
        const outside = ids.filter(id => !allowed.has(id));
        if (outside.length > 0)
            errors.push(
                `${field} cites ${outside.join(", ")}, which ${outside.length === 1 ? "is" : "are"} not in ${slotId}'s evidence.`
            );
    }
    if ((basis === "inferred" || basis === "assumed") && !explanation)
        errors.push(`${field} is ${basis} but gives no explanation.`);

    return {
        value,
        basis,
        evidenceIds: basis === "assumed" ? [] : sortEvidenceIds(ids),
        ...(explanation ? { explanation } : {}),
    };
}

/** Short grounded facts for `Persona.knows`: the context's facts, then the cited passages' best sentences. */
export function knownFacts(context: ActorContext, slot: CastSlot, cited: Set<string>): string[] {
    const want = new Set(tokenize(`${slot.query} ${slot.segment}`));
    const out: string[] = [];
    const add = (text: string) => {
        const t = clip(text, 160);
        if (t && !out.includes(t) && out.length < KNOWS_MAX) out.push(t);
    };
    for (const fact of context.facts) add(fact.text);
    for (const passage of context.passages) {
        if (!cited.has(passage.evidenceId)) continue;
        const sentences = passage.text.split(/(?<=[.!?])\s+/).filter(Boolean);
        let best = sentences[0] ?? "";
        let bestScore = -1;
        for (const s of sentences) {
            const score = tokenize(s).filter(t => want.has(t)).length;
            if (score > bestScore) {
                best = s;
                bestScore = score;
            }
        }
        add(best);
    }
    return out;
}

/**
 * Validate one slot's reply against that slot's own context and build its
 * cast member. `index` is the slot's position in the whole cast (for the
 * provisional agent id; world:freeze assigns the final ones).
 */
export function validateMember(
    raw: unknown,
    slot: CastSlot,
    context: ActorContext,
    index: number,
    options: { dropUnexplained?: boolean } = {}
): MemberValidation {
    const item = asRecord(raw);
    if (!item) return { errors: [`No member came back for ${slot.slotId}.`] };
    const errors: string[] = [];
    const name = clip(cleanProse(asString(item.name) ?? ""), 60);
    if (!name) errors.push("name is empty.");
    const lifted = name ? namesFromEvidence(name, context) : [];
    if (lifted.length > 0)
        errors.push(
            `name "${name}" uses ${lifted.map(l => `"${l}"`).join(", ")} from the evidence; invent a name for this composite person.`
        );

    const allowed = new Set(context.selected.evidenceIds);
    const dropped: AttributedField[] | undefined = options.dropUnexplained ? [] : undefined;
    const attributes = Object.fromEntries(
        ATTRIBUTED_FIELDS.map(field => [
            field,
            readAttributed(item[field], field, allowed, slot.slotId, errors, dropped),
        ])
    ) as Record<AttributedField, Attributed<string>>;
    if (errors.length > 0) return { errors };

    const cited = new Set(
        ATTRIBUTED_FIELDS.flatMap(f =>
            attributes[f].basis === "source" || attributes[f].basis === "inferred"
                ? attributes[f].evidenceIds
                : []
        )
    );
    const clamp = (v: unknown, fallback: number, lo: number) =>
        Math.max(lo, Math.min(1, asNumber(v) ?? fallback));
    const knows = knownFacts(context, slot, cited);
    const persona: Persona = {
        id: `a${index + 1}`,
        name,
        handle: slugHandle(asString(item.handle) ?? "", name),
        role: attributes.role.value ?? clip(slot.segment, 140),
        bio: clip(cleanProse(asString(item.bio) ?? ""), 400),
        interests: asArray(item.interests)
            .map(i => clip(cleanProse(asString(i) ?? ""), 40))
            .filter(Boolean)
            .slice(0, 6),
        stance: slot.stanceTarget,
        activity: clamp(item.activity, 0.35, 0.05),
        influence: clamp(item.influence, 0.2, 0),
        grounding: cited.size > 0 ? "grounded" : "invented",
        sourceIds: sortEvidenceIds(cited),
        ...(attributes.currentSolution.value
            ? { currentSolution: attributes.currentSolution.value }
            : {}),
        ...(attributes.budget.value
            ? { budget: attributes.budget.value as Persona["budget"] }
            : {}),
        ...(attributes.buyingRole.value
            ? { buyingRole: attributes.buyingRole.value as Persona["buyingRole"] }
            : {}),
        ...(attributes.switchingCost.value
            ? { switchingCost: attributes.switchingCost.value as Persona["switchingCost"] }
            : {}),
        ...(attributes.objection.value ? { objection: attributes.objection.value } : {}),
        slotId: slot.slotId,
        ...(knows.length > 0 ? { knows } : {}),
    };
    return {
        member: { slotId: slot.slotId, persona, attributes },
        errors: [],
        ...(dropped && dropped.length > 0 ? { dropped } : {}),
    };
}

/** Members of a GenerateCastBatch reply, by slot id (first one wins). */
export function parseCastBatch(text: string): Map<string, unknown> {
    const out = new Map<string, unknown>();
    const root = asRecord(extractJson(text));
    for (const raw of asArray(root?.members)) {
        const id = (asString(asRecord(raw)?.slotId) ?? "").trim().toLowerCase();
        if (id && !out.has(id)) out.set(id, raw);
    }
    return out;
}

export const castBatchStage: Stage = async ctx => {
    const ids = inputStrings(ctx, "slotIds");
    const plan = await requireCastPlan(ctx);
    const contexts = new Map((await ctx.artifacts.actorContexts()).map(c => [c.slotId, c]));
    const order = new Map(slotIds(ctx.spec.agents).map((id, i) => [id, i]));
    const slots = ids.map(id => {
        const slot = plan.slots.find(s => s.slotId === id);
        const context = contexts.get(id);
        if (!slot) throw new Error(`Slot ${id} is not in the cast plan`);
        if (!context) throw new Error(`Slot ${id} has no actor context`);
        return { slot, context };
    });
    const { text: brief } = await briefText(ctx);
    const base = { subject: ctx.spec.subject, brief, takenHandles: ["@newswire"] };

    const accepted = new Map<string, CastMember>();
    let problems = new Map<string, { errors: string[]; previous: unknown }>();
    const judge = (replyText: string, asked: typeof slots) => {
        const members = parseCastBatch(replyText);
        const next = new Map<string, { errors: string[]; previous: unknown }>();
        for (const { slot, context } of asked) {
            const raw = members.get(slot.slotId);
            const result = validateMember(raw, slot, context, order.get(slot.slotId) ?? 0);
            if (result.member) accepted.set(slot.slotId, result.member);
            else next.set(slot.slotId, { errors: result.errors, previous: raw });
        }
        problems = next;
    };

    const first = await ctx.model.complete(buildCastBatchRequest({ ...base, slots }));
    judge(first.text, slots);
    let repairs = 0;
    while (problems.size > 0 && repairs < ctx.spec.budget.repairsPerUnit) {
        repairs += 1;
        const retry = slots.filter(s => problems.has(s.slot.slotId));
        const reply = await ctx.model.complete(
            buildCastRepairRequest({
                ...base,
                slots: retry,
                problems: retry.map(s => ({
                    slotId: s.slot.slotId,
                    ...problems.get(s.slot.slotId)!,
                })),
            })
        );
        judge(reply.text, retry);
    }

    // Out of repairs: keep a person whose only faults were missing reasons,
    // with those fields unknown.
    const dropped: Record<string, AttributedField[]> = {};
    for (const { slot, context } of slots) {
        const problem = problems.get(slot.slotId);
        if (!problem) continue;
        const result = validateMember(
            problem.previous,
            slot,
            context,
            order.get(slot.slotId) ?? 0,
            { dropUnexplained: true }
        );
        if (!result.member) continue;
        accepted.set(slot.slotId, result.member);
        problems.delete(slot.slotId);
        if (result.dropped) dropped[slot.slotId] = result.dropped;
    }

    const members = ids.map(id => accepted.get(id)).filter((m): m is CastMember => !!m);
    const unfilled = ids.filter(id => !accepted.has(id));
    if (unfilled.length > 0)
        ctx.ports.log?.("scenario cast slots left unfilled", {
            runId: ctx.run.id,
            unit: ctx.unit.key,
            unfilled,
        });
    if (Object.keys(dropped).length > 0)
        ctx.ports.log?.("scenario cast fields dropped for want of a reason", {
            runId: ctx.run.id,
            unit: ctx.unit.key,
            dropped,
        });
    const output: CastBatchOutput & {
        problems: Record<string, string[]>;
        dropped: Record<string, AttributedField[]>;
    } = {
        members,
        unfilled,
        repairs,
        problems: Object.fromEntries(unfilled.map(id => [id, problems.get(id)?.errors ?? []])),
        dropped,
    };
    return { output };
};
