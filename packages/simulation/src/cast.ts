/**
 * The cast — personas built from evidence. MiroFish asks a model to invent
 * agents from the seed text; here every persona must cite the evidence it is
 * drawn from, and anything the evidence doesn't support is labelled invented.
 */

import { asArray, asNumber, asRecord, asString, clampStance, extractJson } from "./json";
import { clip } from "./text";
import type { EvidenceItem, ModelRequest, Persona } from "./types";

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
}

export function formatEvidence(evidence: EvidenceItem[], maxChars = 600): string {
    if (evidence.length === 0) return "(no evidence)";
    return evidence.map(e => `[${e.id}] (${e.kind}) ${e.label}\n${clip(e.text, maxChars)}`).join("\n\n");
}

export function buildCastRequest(input: CastRequestInput): ModelRequest {
    const system = [
        "You build the cast for a social-network simulation: composite people who could plausibly react to the subject.",
        "Ground every persona in the evidence. Put the evidence ids it is drawn from in sourceIds, and take their role, concerns and starting stance only from what that evidence supports.",
        "Never use the name or handle of a real person who appears in the evidence. Invent a plausible name and a handle starting with @.",
        `When the evidence runs out you may add personas with invented: true and empty sourceIds; at most ${input.maxInvented} in this batch.`,
        "Vary them: not everyone agrees (stance -2 strongly against … 2 strongly in favour); most people are lurkers (activity 0.15–0.5) and a few are loud (0.7–1); influence 0–1 is how followed they are.",
        "bio: two sentences in the third person. interests: three to five short phrases.",
        "Reply with JSON only.",
    ].join("\n");
    const prompt = [
        `Subject: ${input.subject}`,
        `Audience: ${input.audience}`,
        input.brief ? `Background:\n${input.brief}` : "",
        "",
        "Evidence:",
        formatEvidence(input.evidence),
        "",
        `Return exactly ${input.count} personas.`,
        input.takenHandles.length > 0 ? `Handles already taken: ${input.takenHandles.join(", ")}` : "",
        'Shape: {"personas": [{"name": "…", "handle": "@…", "role": "…", "bio": "…", "interests": ["…"], "stance": 0, "activity": 0.3, "influence": 0.2, "sourceIds": ["E1"], "invented": false}]}',
    ]
        .filter(Boolean)
        .join("\n");
    return { purpose: "cast", system, prompt, schema: CAST_SCHEMA, maxOutputTokens: 400 * input.count + 200 };
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
 */
export function parseCast(
    text: string,
    context: { evidenceIds: Set<string>; startIndex: number; takenHandles: Set<string>; limit: number }
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
        while (context.takenHandles.has(handle.toLowerCase())) handle = `${handle.replace(/\d+$/, "")}${n++}`;
        context.takenHandles.add(handle.toLowerCase());
        const sourceIds = asArray(item.sourceIds)
            .map(s => asString(s)?.trim().toUpperCase())
            .filter((s): s is string => !!s && context.evidenceIds.has(s));
        const grounded = sourceIds.length > 0 && item.invented !== true;
        const clamp01 = (v: unknown, fallback: number, lo: number) =>
            Math.max(lo, Math.min(1, asNumber(v) ?? fallback));
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
        });
    }
    return out;
}
