/**
 * The cast — personas built from evidence. MiroFish asks a model to invent
 * agents from the seed text; here every persona must cite the evidence it is
 * drawn from, and anything the evidence doesn't support is labelled invented.
 *
 * Every persona also has a wallet (what they use today, their budget, their
 * part in buying, what switching would cost them, their first doubt), and a
 * cast is asked for a starting mix of stances in which most people are wary.
 * Models write agreeable crowds when left alone; `skepticShortfall` and
 * `seatsToRecast` let the host ask once more when one comes back too warm.
 */

import { asArray, asNumber, asRecord, asString, clampStance, extractJson } from "./json";
import { clip } from "./text";
import {
    BUDGETS,
    BUYING_ROLES,
    SWITCHING_COSTS,
    type EvidenceItem,
    type ModelRequest,
    type Persona,
    type Stance,
} from "./types";

export const CAST_SCHEMA: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    properties: {
        personas: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    name: { type: "string" },
                    handle: { type: "string" },
                    role: { type: "string" },
                    bio: { type: "string" },
                    interests: { type: "array", items: { type: "string" } },
                    stance: { type: "integer", minimum: -2, maximum: 2 },
                    activity: { type: "number" },
                    influence: { type: "number" },
                    sourceIds: { type: "array", items: { type: "string" } },
                    invented: { type: "boolean" },
                    currentSolution: { type: "string" },
                    budget: { type: "string", enum: BUDGETS },
                    buyingRole: { type: "string", enum: BUYING_ROLES },
                    switchingCost: { type: "string", enum: SWITCHING_COSTS },
                    objection: { type: "string" },
                },
                required: [
                    "name",
                    "handle",
                    "role",
                    "bio",
                    "interests",
                    "stance",
                    "activity",
                    "influence",
                    "sourceIds",
                    "invented",
                    "currentSolution",
                    "budget",
                    "buyingRole",
                    "switchingCost",
                    "objection",
                ],
            },
        },
    },
    required: ["personas"],
};

export interface CastRequestInput {
    subject: string;
    brief: string;
    evidence: EvidenceItem[];
    /** How many personas this call should return. */
    count: number;
    /** Handles already used by earlier batches. */
    takenHandles: string[];
    /** Who the audience is, e.g. "people who would see this company's LinkedIn post". */
    audience: string;
    /** Most invented personas this batch may add. */
    maxInvented: number;
    /** Shares of starting stances to ask for (default {@link REALISTIC_MIX}). */
    mix?: StartingMix;
}

/** Shares of a cast that start against, undecided and in favour; they add up to 1. */
export interface StartingMix {
    against: number;
    undecided: number;
    inFavour: number;
}

/** Most people start wary of anything that asks for their money or their time. */
export const REALISTIC_MIX: StartingMix = { against: 0.35, undecided: 0.4, inFavour: 0.25 };

/** A mix where everyone starts against: the seats a host asks for again. */
export const ALL_AGAINST: StartingMix = { against: 1, undecided: 0, inFavour: 0 };

/**
 * Whole people for each share of `count`, by largest remainder; ties go to
 * the warier side, so a cast never rounds its way out of its skeptics.
 */
export function mixCounts(
    count: number,
    mix: StartingMix
): { against: number; undecided: number; inFavour: number } {
    const keys = ["against", "undecided", "inFavour"] as const;
    const total = keys.reduce((s, k) => s + Math.max(0, mix[k]), 0) || 1;
    const exact = keys.map(k => (Math.max(0, mix[k]) / total) * count);
    const out = exact.map(Math.floor);
    let left = count - out.reduce((s, v) => s + v, 0);
    const order = [0, 1, 2].sort((a, b) => exact[b]! - out[b]! - (exact[a]! - out[a]!) || a - b);
    for (const i of order) {
        if (left <= 0) break;
        out[i]! += 1;
        left -= 1;
    }
    return { against: out[0]!, undecided: out[1]!, inFavour: out[2]! };
}

export function formatEvidence(evidence: EvidenceItem[], maxChars = 600): string {
    if (evidence.length === 0) return "(no evidence)";
    return evidence
        .map(e => `[${e.id}] (${e.kind}) ${e.label}\n${clip(e.text, maxChars)}`)
        .join("\n\n");
}

export function buildCastRequest(input: CastRequestInput): ModelRequest {
    const system = [
        "You build the cast for a social-network simulation: composite people who could plausibly react to the subject.",
        "Ground every persona in the evidence. Put the evidence ids it is drawn from in sourceIds, and take their role and concerns only from what that evidence supports.",
        "Never use the name or handle of a real person who appears in the evidence. Invent a plausible name and a handle starting with @.",
        `When the evidence runs out you may add personas with invented: true and empty sourceIds; at most ${input.maxInvented} in this batch.`,
        "stance is where they start on the subject: -2 strongly against … 2 strongly in favour. Follow the starting stances given below. Someone drawn from evidence that shows them already positive (a happy customer's comment, say) may start in favour whatever the numbers.",
        "People who start against are realistic, not cartoon critics: content with what they use now, burned by a similar tool before, short of budget, or unsure it is worth the switch.",
        "Most people are lurkers (activity 0.15–0.5) and a few are loud (0.7–1); influence 0–1 is how followed they are.",
        'Give each person a wallet, taken from the evidence where it says. currentSolution: what they use for this today (a product or competitor the evidence names, a spreadsheet, an agency, or "nothing"); never make up a product name. budget: none, tight or funded; most small teams are tight. buyingRole: decides, influences or uses. switchingCost: low, medium or high, by how much time, data and habit sits in what they use now. objection: their first doubt about the subject, one sentence in their own voice.',
        "bio: two sentences in the third person. interests: three to five short phrases.",
        "Reply with JSON only.",
    ].join("\n");
    const mix = mixCounts(input.count, input.mix ?? REALISTIC_MIX);
    const prompt = [
        `Subject: ${input.subject}`,
        `Audience: ${input.audience}`,
        input.brief ? `Background:\n${input.brief}` : "",
        "",
        "Evidence:",
        formatEvidence(input.evidence),
        "",
        `Return exactly ${input.count} personas.`,
        `Starting stances for these ${input.count}: ${mix.against} against (-1 or -2), ${mix.undecided} undecided (0), ${mix.inFavour} in favour (1 or 2).`,
        input.takenHandles.length > 0
            ? `Handles already taken: ${input.takenHandles.join(", ")}`
            : "",
        'Shape: {"personas": [{"name": "…", "handle": "@…", "role": "…", "bio": "…", "interests": ["…"], "stance": 0, "activity": 0.3, "influence": 0.2, "sourceIds": ["E1"], "invented": false, "currentSolution": "…", "budget": "tight", "buyingRole": "influences", "switchingCost": "medium", "objection": "…"}]}',
    ]
        .filter(Boolean)
        .join("\n");
    return {
        purpose: "cast",
        system,
        prompt,
        schema: CAST_SCHEMA,
        maxOutputTokens: 480 * input.count + 200,
    };
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
    const v = asString(value)?.trim().toLowerCase();
    return options.find(o => o === v) ?? fallback;
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

/**
 * Parse a cast reply. Ids are assigned from `startIndex`; handles are made
 * unique against `takenHandles` (which this function extends). A persona that
 * cites no known evidence id is marked invented, whatever the model said.
 * Budget, buying role and switching cost fall back to the cautious middle
 * (tight, uses, medium); a current solution or objection the model left out
 * stays out.
 */
export function parseCast(
    text: string,
    context: {
        evidenceIds: Set<string>;
        startIndex: number;
        takenHandles: Set<string>;
        limit: number;
    }
): Persona[] {
    const root = asRecord(extractJson(text));
    if (!root) return [];
    const out: Persona[] = [];
    for (const raw of asArray(root.personas)) {
        if (out.length >= context.limit) break;
        const item = asRecord(raw);
        if (!item) continue;
        const name = clip(asString(item.name) ?? "", 60);
        const role = clip(asString(item.role) ?? "", 140);
        if (!name || !role) continue;
        let handle = slugHandle(asString(item.handle) ?? "", name);
        let n = 2;
        while (context.takenHandles.has(handle.toLowerCase()))
            handle = `${handle.replace(/\d+$/, "")}${n++}`;
        context.takenHandles.add(handle.toLowerCase());
        const sourceIds = asArray(item.sourceIds)
            .map(s => asString(s)?.trim().toUpperCase())
            .filter((s): s is string => !!s && context.evidenceIds.has(s));
        const grounded = sourceIds.length > 0 && item.invented !== true;
        const clamp01 = (v: unknown, fallback: number, lo: number) =>
            Math.max(lo, Math.min(1, asNumber(v) ?? fallback));
        const currentSolution = clip(asString(item.currentSolution)?.trim() ?? "", 80);
        const objection = clip(asString(item.objection)?.trim() ?? "", 200);
        out.push({
            id: `a${context.startIndex + out.length}`,
            name,
            handle,
            role,
            bio: clip(asString(item.bio) ?? "", 400),
            interests: asArray(item.interests)
                .map(i => clip(asString(i) ?? "", 40))
                .filter(Boolean)
                .slice(0, 6),
            stance: clampStance(item.stance, 0),
            activity: clamp01(item.activity, 0.35, 0.05),
            influence: clamp01(item.influence, 0.2, 0),
            grounding: grounded ? "grounded" : "invented",
            sourceIds: grounded ? [...new Set(sourceIds)] : [],
            ...(currentSolution ? { currentSolution } : {}),
            budget: oneOf(item.budget, BUDGETS, "tight"),
            buyingRole: oneOf(item.buyingRole, BUYING_ROLES, "uses"),
            switchingCost: oneOf(item.switchingCost, SWITCHING_COSTS, "medium"),
            ...(objection ? { objection } : {}),
        });
    }
    return out;
}

/** How many more people a cast needs starting against to reach `mix`. */
export function skepticShortfall(personas: Persona[], mix: StartingMix): number {
    const against = personas.filter(p => p.stance < 0).length;
    return Math.max(0, mixCounts(personas.length, mix).against - against);
}

/**
 * Which seats to cast again when a cast starts too warm: invented people
 * first, then the undecided, and people grounded in evidence while in favour
 * last, since evidence may say they really are fans. Warmest first within
 * each group; later seats before earlier ones on a tie.
 */
export function seatsToRecast(personas: Persona[], n: number): string[] {
    const group = (p: Persona) => (p.grounding === "invented" ? 0 : p.stance === 0 ? 1 : 2);
    const index = new Map(personas.map((p, i) => [p.id, i]));
    return personas
        .filter(p => p.stance >= 0)
        .sort(
            (a, b) =>
                group(a) - group(b) || b.stance - a.stance || index.get(b.id)! - index.get(a.id)!
        )
        .slice(0, Math.max(0, n))
        .map(p => p.id);
}

/**
 * Put `replacements` into the given seats, in order: each keeps the seat's
 * id and starts against (a replacement the model wrote warmer is set to -1).
 * Seats left without a replacement keep their person.
 */
export function fillSeats(
    personas: Persona[],
    seatIds: string[],
    replacements: Persona[]
): Persona[] {
    const bySeat = new Map(
        seatIds.slice(0, replacements.length).map((id, i) => [id, replacements[i]!])
    );
    return personas.map(p => {
        const next = bySeat.get(p.id);
        if (!next) return p;
        return { ...next, id: p.id, stance: Math.min(next.stance, -1) as Stance };
    });
}
