/**
 * Requests for the three contract-v2 model purposes — `ontology` (PlanOntology),
 * `cast_plan` (PlanCast) and `cast_v2` (GenerateCastBatch) — and their JSON
 * reply schemas. The zod mirrors that hosts with structured output enforce
 * live in `../../model.ts`; `prompts.test.ts` keeps the two in step.
 *
 * Builders are pure: the same inputs give the same request, so a retried
 * unit is served from the call journal.
 */
import {
    BUDGETS,
    BUYING_ROLES,
    clip,
    stanceLabel,
    SWITCHING_COSTS,
    type ModelRequest,
    type Stance,
} from "@launchstack/simulation";

import {
    ATTRIBUTED_FIELDS,
    BASES,
    BASE_ONTOLOGY,
    ONTOLOGY_LIMITS,
    RESERVED_ONTOLOGY_NAMES,
    type ActorContext,
    type CastSlot,
    type EvidenceSnapshot,
} from "../contracts";
import { approxTokens } from "../hash";
import { UNIT_TOKEN_CAPS } from "../plan";

// ─── JSON schemas ────────────────────────────────────────────────────────────

const ATTRIBUTE_JSON = {
    type: "object",
    additionalProperties: false,
    properties: {
        name: { type: "string" },
        type: { type: "string", enum: ["string", "number", "boolean"] },
        description: { type: "string" },
    },
    required: ["name", "type", "description"],
};

export const ONTOLOGY_SCHEMA: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    properties: {
        entities: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                    attributes: { type: "array", items: ATTRIBUTE_JSON },
                    motivatingEvidenceId: { type: "string" },
                },
                required: ["name", "description", "attributes", "motivatingEvidenceId"],
            },
        },
        edges: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                    attributes: { type: "array", items: ATTRIBUTE_JSON },
                    endpoints: {
                        type: "array",
                        items: {
                            type: "object",
                            additionalProperties: false,
                            properties: {
                                source: { type: "string" },
                                target: { type: "string" },
                            },
                            required: ["source", "target"],
                        },
                    },
                    motivatingEvidenceId: { type: "string" },
                },
                required: [
                    "name",
                    "description",
                    "attributes",
                    "endpoints",
                    "motivatingEvidenceId",
                ],
            },
        },
    },
    required: ["entities", "edges"],
};

export const CAST_PLAN_SCHEMA: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    properties: {
        slots: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    slotId: { type: "string" },
                    segment: { type: "string" },
                    query: { type: "string" },
                },
                required: ["slotId", "segment", "query"],
            },
        },
    },
    required: ["slots"],
};

function attributedJson(value: Record<string, unknown>): Record<string, unknown> {
    return {
        type: "object",
        additionalProperties: false,
        properties: {
            value,
            basis: { type: "string", enum: BASES },
            evidenceIds: { type: "array", items: { type: "string" } },
            explanation: { type: ["string", "null"] },
        },
        required: ["value", "basis", "evidenceIds", "explanation"],
    };
}

const TEXT_OR_NULL = { type: ["string", "null"] };
const enumOrNull = (values: readonly string[]) => ({
    type: ["string", "null"],
    enum: [...values, null],
});

export const CAST_V2_SCHEMA: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    properties: {
        members: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    slotId: { type: "string" },
                    name: { type: "string" },
                    handle: { type: "string" },
                    bio: { type: "string" },
                    interests: { type: "array", items: { type: "string" } },
                    activity: { type: "number" },
                    influence: { type: "number" },
                    role: attributedJson(TEXT_OR_NULL),
                    currentSolution: attributedJson(TEXT_OR_NULL),
                    budget: attributedJson(enumOrNull(BUDGETS)),
                    buyingRole: attributedJson(enumOrNull(BUYING_ROLES)),
                    switchingCost: attributedJson(enumOrNull(SWITCHING_COSTS)),
                    objection: attributedJson(TEXT_OR_NULL),
                },
                required: [
                    "slotId",
                    "name",
                    "handle",
                    "bio",
                    "interests",
                    "activity",
                    "influence",
                    ...ATTRIBUTED_FIELDS,
                ],
            },
        },
    },
    required: ["members"],
};

// ─── PlanOntology ────────────────────────────────────────────────────────────

/** Tokens of passages the ontology planner reads across all documents. */
const ONTOLOGY_PASSAGE_TOKENS = 5_000;
/** Each document gets at least this many, so no selected file goes unread. */
const ONTOLOGY_PER_DOCUMENT_MIN = 150;

function documentGroups(items: EvidenceSnapshot[]): Map<number, EvidenceSnapshot[]> {
    const groups = new Map<number, EvidenceSnapshot[]>();
    for (const item of items) {
        if (item.sourceType !== "document" && item.sourceType !== "search") continue;
        const id = item.documentIds[0] ?? item.locator.documentId;
        if (id == null) continue;
        groups.set(id, [...(groups.get(id) ?? []), item]);
    }
    return groups;
}

/** Passages from every selected document, best first, within a per-document share. */
export function representativePassages(items: EvidenceSnapshot[]): string {
    const groups = documentGroups(items);
    if (groups.size === 0) return "(no documents)";
    const share = Math.max(
        ONTOLOGY_PER_DOCUMENT_MIN,
        Math.floor(ONTOLOGY_PASSAGE_TOKENS / groups.size)
    );
    const blocks: string[] = [];
    for (const [documentId, list] of groups) {
        const lines: string[] = [];
        let used = 0;
        for (const item of list) {
            const left = share - used;
            if (left < 40) break;
            const text = clip(item.quote, left * 4);
            lines.push(`[${item.id}] ${text}`);
            used += approxTokens(text) + 4;
        }
        blocks.push(`From ${list[0]!.label} (file ${documentId}):\n${lines.join("\n")}`);
    }
    return blocks.join("\n\n");
}

function baseSchemaText(): string {
    const entities = BASE_ONTOLOGY.entities.map(
        e =>
            `- ${e.name}: ${e.description}${e.attributes.length ? ` Attributes: ${e.attributes.map(a => `${a.name} (${a.type})`).join(", ")}.` : ""}`
    );
    const edges = BASE_ONTOLOGY.edges.map(
        e =>
            `- ${e.name}: ${e.description} Endpoints: ${e.endpoints.map(p => `${p.source} → ${p.target}`).join(", ")}.`
    );
    return `Entity types:\n${entities.join("\n")}\nEdge types:\n${edges.join("\n")}`;
}

export function buildOntologyRequest(input: {
    subject: string;
    items: EvidenceSnapshot[];
}): ModelRequest {
    const L = ONTOLOGY_LIMITS;
    const baseEntities = BASE_ONTOLOGY.entities.length;
    const baseEdges = BASE_ONTOLOGY.edges.length;
    const system = [
        "You plan the schema of a knowledge graph that will be extracted from a company's evidence. The graph grounds the people in a simulation of how a market reacts to a situation.",
        "You start from the base schema given below. It already covers organizations, people, products and purchase decisions, and who works for, uses, influences, approves and decides on what.",
        "Propose an extension only when the evidence names a kind of thing or relation that the base schema cannot express and that would change how someone in the simulation reacts: a contract and its renewal date, a migration project, a regulation, an integration someone depends on. Most scenarios need none, or one to three. Never restate a base type, and never add a type the evidence does not show.",
        "Rules for every extension:",
        `- Entity type names are PascalCase, like "Contract". Edge type names are SCREAMING_SNAKE_CASE, like "MIGRATES_FROM". Attribute names are snake_case, like "renewal_date". Names are at most ${L.nameMax} characters.`,
        `- These names are reserved and may not be used for a type or an attribute: ${RESERVED_ONTOLOGY_NAMES.join(", ")}.`,
        `- An attribute's type is "string", "number" or "boolean"; at most ${L.attributesPerType} attributes per type. Attributes hold what the evidence states. A value the evidence gives as approximate ("approximately fourteen days") is a string that keeps the hedge, not a number.`,
        `- An edge lists its allowed endpoints (1 to ${L.endpointsPerEdge}) as pairs of entity type names, taken from the base schema or from your own new entity types.`,
        '- motivatingEvidenceId is the id of the passage that shows the type is needed, like "E3". It must be one of the evidence ids listed.',
        `- In total, base included, at most ${L.entityTypes} entity types (so at most ${L.entityTypes - baseEntities} new ones) and ${L.edgeTypes} edge types (at most ${L.edgeTypes - baseEdges} new).`,
        `- Each description is one plain sentence of at most ${L.descriptionMax} characters.`,
        'If the base schema is enough, reply {"entities": [], "edges": []}.',
        "Reply with JSON only.",
    ].join("\n");
    const facts = input.items.filter(i => i.fact);
    const others = input.items.filter(
        i => i.sourceType !== "document" && i.sourceType !== "search" && !i.fact
    );
    const prompt = [
        `Scenario: ${input.subject}`,
        "",
        "Base schema:",
        baseSchemaText(),
        "",
        "Evidence ids (everything the run captured):",
        input.items.map(i => `${i.id} (${i.kind}) ${i.label}`).join("\n") || "(none)",
        "",
        "Typed company facts already known:",
        facts.length > 0
            ? facts.map(i => `- [${i.id}] ${i.fact!.key}: ${clip(i.fact!.label, 80)}`).join("\n")
            : "(none)",
        "",
        "Representative passages from each document:",
        representativePassages(input.items),
        ...(others.length > 0
            ? [
                  "",
                  "Other evidence:",
                  others
                      .slice(0, 8)
                      .map(i => `[${i.id}] (${i.kind}) ${clip(i.quote, 300)}`)
                      .join("\n"),
              ]
            : []),
        "",
        'Shape: {"entities": [{"name": "Contract", "description": "…", "attributes": [{"name": "renewal_date", "type": "string", "description": "…"}], "motivatingEvidenceId": "E2"}], "edges": [{"name": "MIGRATES_FROM", "description": "…", "attributes": [], "endpoints": [{"source": "Organization", "target": "Product"}], "motivatingEvidenceId": "E2"}]}',
    ].join("\n");
    return {
        purpose: "ontology",
        system,
        prompt,
        schema: ONTOLOGY_SCHEMA,
        maxOutputTokens: UNIT_TOKEN_CAPS.ontology.output,
    };
}

/** The same request with the last reply and what was wrong with it. */
export function withRepair(
    request: ModelRequest,
    previous: string,
    errors: string[]
): ModelRequest {
    return {
        ...request,
        prompt: [
            request.prompt,
            "",
            "Your previous reply:",
            previous,
            "",
            "It broke these rules:",
            ...errors.map(e => `- ${e}`),
            "",
            "Reply again with the whole corrected answer, following every rule.",
        ].join("\n"),
    };
}

// ─── PlanCast ────────────────────────────────────────────────────────────────

function startsLine(stance: Stance): string {
    return `starts ${stanceLabel(stance)}`;
}

export function buildCastPlanRequest(input: {
    subject: string;
    audience: string;
    brief: string;
    items: EvidenceSnapshot[];
    slots: Array<Pick<CastSlot, "slotId" | "stanceTarget">>;
}): ModelRequest {
    const system = [
        "You plan the cast of a social-network simulation: the kinds of people who would react to the subject. Each slot below is one person.",
        "For each slot write:",
        "- segment: who this person is, in under 15 words, as specific as the evidence allows: their role, the kind of organization, their part in buying. A type of person, never a real person's name.",
        "- query: a search query of under 20 words for finding the evidence about this kind of person: what they use today, what they pay, who decides, what would stop them.",
        'Spread the slots across the audience in proportions the evidence supports, and give no two slots the same segment. Where the evidence says nothing about a kind of person, say so plainly in the segment ("a prospect the evidence does not describe") rather than inventing details.',
        "Each slot already has a starting view on the subject; pick a segment that could plausibly hold it.",
        "Reply with JSON only.",
    ].join("\n");
    // One line per item, best first, until the overview's share of the input cap is used.
    const fixed = 1_500 + approxTokens(input.subject) + approxTokens(input.brief);
    const room = Math.max(100, UNIT_TOKEN_CAPS.castPlanBase.input - fixed);
    const overview: string[] = [];
    let used = 0;
    for (const i of input.items) {
        const line = `[${i.id}] (${i.kind}) ${i.label}: ${clip(i.quote, 160)}`;
        if (used + approxTokens(line) > room) break;
        overview.push(line);
        used += approxTokens(line);
    }
    const prompt = [
        `Subject: ${input.subject}`,
        `Audience: ${input.audience}`,
        input.brief ? `Background:\n${input.brief}` : null,
        "",
        "Evidence available:",
        overview.length > 0 ? overview.join("\n") : "(none)",
        "",
        "Slots:",
        input.slots.map(s => `${s.slotId}: ${startsLine(s.stanceTarget)}`).join("\n"),
        "",
        `Return one entry for each of the ${input.slots.length} slots.`,
        'Shape: {"slots": [{"slotId": "s01", "segment": "…", "query": "…"}]}',
    ]
        .filter((line): line is string => line !== null)
        .join("\n");
    return {
        purpose: "cast_plan",
        system,
        prompt,
        schema: CAST_PLAN_SCHEMA,
        maxOutputTokens:
            UNIT_TOKEN_CAPS.castPlanBase.output +
            UNIT_TOKEN_CAPS.castPlanPerSlot.output * input.slots.length,
    };
}

// ─── GenerateCastBatch ───────────────────────────────────────────────────────

/** One slot's block: who, where they start, and the only evidence they may cite. */
export function slotBlock(slot: CastSlot, context: ActorContext): string {
    const facts = context.facts.map(
        f => `- (${f.evidenceIds.join(", ") || "no evidence id"}) ${f.text}`
    );
    const passages = context.passages.map(p => `[${p.evidenceId}]\n${p.text}`);
    return [
        `## Slot ${slot.slotId}`,
        `Who: ${slot.segment}`,
        `Starts: ${stanceLabel(slot.stanceTarget)} on the subject`,
        `Evidence for ${slot.slotId} only:`,
        facts.length > 0 ? `Facts:\n${facts.join("\n")}` : "",
        passages.length > 0 ? `Passages:\n${passages.join("\n\n")}` : "",
        facts.length === 0 && passages.length === 0
            ? "(none: everything is assumed or unknown)"
            : "",
    ]
        .filter(Boolean)
        .join("\n");
}

export function buildCastBatchRequest(input: {
    subject: string;
    brief: string;
    slots: Array<{ slot: CastSlot; context: ActorContext }>;
    takenHandles: string[];
}): ModelRequest {
    const system = [
        "You write the people in a social-network simulation. Each person fills one slot, and each slot has its own evidence block. A person may draw only on the evidence in their own slot's block.",
        "These are composite, fictional people. Invent a plausible name and a handle starting with @. Never use the name of anyone who appears in the evidence, and never present the person as a real, named individual.",
        "Give every person six attributed fields: role, currentSolution, budget, buyingRole, switchingCost and objection. Each is an object {value, basis, evidenceIds, explanation}:",
        '- basis "source": the slot\'s evidence states it. evidenceIds lists the ids (like "E2") that state it.',
        '- basis "inferred": it follows from the slot\'s evidence without being stated. evidenceIds lists the ids it follows from; explanation gives the step in one sentence.',
        '- basis "assumed": the evidence says nothing either way and you chose a plausible value so the person is whole. explanation says why in one sentence; evidenceIds is empty.',
        '- basis "unknown": nothing supports a value. value is null, evidenceIds is empty, explanation is null.',
        'Keep unknowns unknown: never label a guess as source or inferred, and use unknown for budget unless the slot\'s evidence says something about money. Keep approximate values approximate: when the evidence hedges ("approximately", "about", "most"), so do you. Cite only ids that appear in that person\'s own slot block.',
        "What the fields mean:",
        "- role: what they do and where, in one line.",
        '- currentSolution: what they use for this today: a product the evidence names, a spreadsheet, an agency, or "nothing". Never make up a product name.',
        "- budget: none, tight or funded.",
        "- buyingRole: decides, influences or uses.",
        "- switchingCost: low, medium or high, by how much time, data and habit sits in what they use now.",
        "- objection: their first doubt about the subject, one sentence in their own voice.",
        "Also give bio (two sentences in the third person), interests (three to five short phrases), activity from 0.05 to 1 (most people are lurkers at 0.15–0.5, a few are loud at 0.7–1) and influence from 0 to 1.",
        "Each slot says where the person starts on the subject; keep their bio and objection consistent with it.",
        "Reply with JSON only.",
    ].join("\n");
    const ids = input.slots.map(s => s.slot.slotId);
    const prompt = [
        `Subject: ${input.subject}`,
        input.brief ? `Background everyone knows:\n${input.brief}` : null,
        input.takenHandles.length > 0
            ? `Handles already taken: ${input.takenHandles.join(", ")}`
            : null,
        "",
        input.slots.map(s => slotBlock(s.slot, s.context)).join("\n\n"),
        "",
        `Return one member for each slot, in this order: ${ids.join(", ")}.`,
        'Shape: {"members": [{"slotId": "s01", "name": "…", "handle": "@…", "bio": "…", "interests": ["…"], "activity": 0.3, "influence": 0.2, "role": {"value": "…", "basis": "source", "evidenceIds": ["E1"], "explanation": null}, "currentSolution": {"value": "…", "basis": "source", "evidenceIds": ["E2"], "explanation": null}, "budget": {"value": null, "basis": "unknown", "evidenceIds": [], "explanation": null}, "buyingRole": {"value": "influences", "basis": "source", "evidenceIds": ["E1"], "explanation": null}, "switchingCost": {"value": "high", "basis": "inferred", "evidenceIds": ["E2"], "explanation": "…"}, "objection": {"value": "…", "basis": "assumed", "evidenceIds": [], "explanation": "…"}}]}',
    ]
        .filter((line): line is string => line !== null)
        .join("\n");
    return {
        purpose: "cast_v2",
        system,
        prompt,
        schema: CAST_V2_SCHEMA,
        maxOutputTokens:
            UNIT_TOKEN_CAPS.castBatchBase.output +
            UNIT_TOKEN_CAPS.castBatchPerSlot.output * input.slots.length,
    };
}

/** The batch request for only the slots to write again, with what was wrong. */
export function buildCastRepairRequest(input: {
    subject: string;
    brief: string;
    slots: Array<{ slot: CastSlot; context: ActorContext }>;
    takenHandles: string[];
    problems: Array<{ slotId: string; errors: string[]; previous: unknown }>;
}): ModelRequest {
    const base = buildCastBatchRequest(input);
    const lines = input.problems.flatMap(p => [
        `${p.slotId}:`,
        ...p.errors.map(e => `- ${e}`),
        `Previous answer: ${p.previous === undefined ? "(missing)" : JSON.stringify(p.previous)}`,
    ]);
    return {
        ...base,
        prompt: [
            base.prompt,
            "",
            "Your previous answer for these slots broke the rules:",
            ...lines,
            "",
            "Write these slots again, following every rule.",
        ].join("\n"),
    };
}
