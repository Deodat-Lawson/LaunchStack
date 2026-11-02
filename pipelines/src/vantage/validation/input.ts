import { createHash } from "node:crypto";
import { z } from "zod";
import { EvaluationInputSchema, type EvaluationInput, type OutputUnit } from "./contracts";
import { contextSourceKeyV0, type ContextSourceRefV0 } from "../proposals/context-v0";

export const MAX_EVALUATION_INPUT_BYTES = 14000;
export function fingerprint(value: unknown): string {
    const stable = (v: unknown): unknown =>
        Array.isArray(v)
            ? v.map(stable)
            : v && typeof v === "object"
              ? Object.fromEntries(
                    Object.entries(v)
                        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                        .map(([k, item]) => [k, stable(item)])
                )
              : v;
    return createHash("sha256")
        .update(JSON.stringify(stable(value)))
        .digest("hex");
}
export function parseEvaluationInput(raw: unknown): EvaluationInput {
    if (Buffer.byteLength(JSON.stringify(raw) ?? "", "utf8") > MAX_EVALUATION_INPUT_BYTES)
        throw new Error(
            "Evaluation input exceeds 14000 bytes; explicitly prepare smaller scenario excerpts. Nothing was truncated."
        );
    const parsed = EvaluationInputSchema.safeParse(raw);
    if (!parsed.success)
        throw new Error(
            "Invalid evaluation input. Use the versioned scenario/expectation/output schema."
        );
    const input = parsed.data;
    for (const list of [input.scenario.documents, input.scenario.expectations, input.actual.tasks])
        if (new Set(list.map(item => item.id)).size !== list.length)
            throw new Error("Evaluation IDs must be unique within each collection.");
    if (
        new Set(input.actual.enhancements.map(item => item.id)).size !==
        input.actual.enhancements.length
    )
        throw new Error("Enhancement IDs must be unique.");
    const docs = new Map(input.scenario.documents.map(doc => [doc.id, doc]));
    for (const expectation of input.scenario.expectations) {
        for (const citation of expectation.evidence) {
            const doc = docs.get(citation.sourceId);
            if (
                !doc ||
                !doc.text.includes(citation.quote) ||
                Date.parse(doc.availableAt) > Date.parse(input.scenario.asOf)
            )
                throw new Error(
                    "Expectation evidence must quote an available source at the scenario cutoff."
                );
        }
    }
    return input;
}

/** Give every part of the report an address so judge explanations can be verified. */
export function outputUnits(input: EvaluationInput): OutputUnit[] {
    const units: OutputUnit[] = [{ id: "summary", text: input.actual.summary, sourceIds: [] }];
    for (const task of input.actual.tasks) {
        const add = (field: string, text: string | null, sourceIds: string[] = []) => {
            if (text) units.push({ id: `task/${task.id}/${field}`, text, sourceIds });
        };
        for (const field of [
            "title",
            "whyItMatters",
            "decisionQuestion",
            "nextStep",
            "rationale",
            "owner",
            "dueOn",
            "helpRequested",
        ] as const)
            add(field, task[field]);
        if (task.dueInDays != null) add("dueInDays", String(task.dueInDays));
        task.facts.forEach((fact, index) =>
            units.push({
                id: `task/${task.id}/fact/${index}`,
                text: fact.text,
                sourceIds: fact.sourceIds,
                ...(fact.unsupported === undefined ? {} : { unsupported: fact.unsupported }),
            })
        );
        task.conflicts.forEach((fact, index) =>
            add(`conflict/${index}`, fact.text, fact.sourceIds)
        );
        task.unknowns.forEach((unknown, index) => add(`unknown/${index}`, unknown));
    }
    for (const enhancement of input.actual.enhancements) {
        units.push({
            id: `enhancement/${enhancement.id}/${enhancement.kind}`,
            text: enhancement.text,
            sourceIds: enhancement.sourceIds,
        });
        if (enhancement.rationale)
            units.push({
                id: `enhancement/${enhancement.id}/rationale`,
                text: enhancement.rationale,
                sourceIds: [],
            });
    }
    return units;
}

const refSchema = z.union([
    z.string().min(1),
    z.object({ ref: z.string() }).passthrough(),
    z
        .object({
            kind: z.enum(["ev", "obs", "cm", "doc", "company", "public"]),
            id: z.string(),
            version: z.string(),
        })
        .passthrough(),
]);
const factSchema = z
    .object({ text: z.string(), refs: z.array(refSchema), unsupported: z.boolean().optional() })
    .passthrough();
const reportSchema = z
    .object({
        summary: z.string(),
        topics: z.array(
            z
                .object({
                    title: z.string(),
                    facts: z.array(factSchema),
                    conflicts: z.array(factSchema),
                    whyItMatters: z.string(),
                    decisionQuestion: z.string(),
                    proposedNextStep: z.string(),
                    proposedOwner: z.string().nullable(),
                    proposedDue: z.string().nullable().optional(),
                    proposedDueInDays: z.number().int().min(0).max(3650).nullable().optional(),
                    helpRequested: z.string().nullable(),
                    unknowns: z.array(z.string()),
                    rationale: z.string(),
                })
                .passthrough()
        ),
    })
    .passthrough();

/** Accept a V1 GenerationResult/AgendaDraft or the leader's ExperimentalReportV0. */
export function normalizeVantageOutput(
    raw: unknown,
    identity: { id: string; pipelineVersion: string }
): EvaluationInput["actual"] {
    const candidate =
        raw && typeof raw === "object" && "draft" in raw
            ? raw.draft
            : raw && typeof raw === "object" && "report" in raw
              ? raw.report
              : raw;
    const parsed = reportSchema.safeParse(candidate);
    if (!parsed.success)
        throw new Error(
            "Expected a saved Vantage draft or experimental report, not arbitrary model text."
        );
    const refId = (ref: z.infer<typeof refSchema>) =>
        typeof ref === "string"
            ? ref
            : "ref" in ref && typeof ref.ref === "string"
              ? ref.ref
              : contextSourceKeyV0(ref as ContextSourceRefV0);
    const enhancementInput =
        raw && typeof raw === "object" && "enhancements" in raw
            ? raw.enhancements
            : candidate && typeof candidate === "object" && "enhancements" in candidate
              ? candidate.enhancements
              : [];
    const enhancements = z
        .array(
            z
                .object({
                    topicId: z.string(),
                    kind: z.enum(["evidence", "idea", "question"]),
                    text: z.string(),
                    rationale: z.string(),
                    refs: z.array(refSchema),
                })
                .passthrough()
        )
        .safeParse(enhancementInput);
    if (!enhancements.success) throw new Error("Invalid Vantage enhancements.");
    return {
        ...identity,
        summary: parsed.data.summary,
        enhancements: enhancements.data.map((item, index) => ({
            id: `enhancement-${index + 1}`,
            topicId: item.topicId,
            kind: item.kind,
            text: item.text,
            rationale: item.rationale,
            sourceIds: item.refs.map(refId),
        })),
        tasks: parsed.data.topics.map((topic, index) => ({
            id: `topic-${index + 1}`,
            title: topic.title,
            facts: topic.facts.map(fact => ({
                text: fact.text,
                sourceIds: fact.refs.map(refId),
                ...(fact.unsupported === undefined ? {} : { unsupported: fact.unsupported }),
            })),
            conflicts: topic.conflicts.map(fact => ({
                text: fact.text,
                sourceIds: fact.refs.map(refId),
            })),
            whyItMatters: topic.whyItMatters,
            decisionQuestion: topic.decisionQuestion,
            nextStep: topic.proposedNextStep,
            owner: topic.proposedOwner,
            dueOn: topic.proposedDue ?? null,
            ...(topic.proposedDueInDays === undefined
                ? {}
                : { dueInDays: topic.proposedDueInDays }),
            helpRequested: topic.helpRequested,
            unknowns: topic.unknowns,
            rationale: topic.rationale,
        })),
    };
}
