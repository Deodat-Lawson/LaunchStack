import { z } from "zod";
import {
    contextSourceKeyV0,
    type BusinessRoleContextV0,
    type ContextSourceRefV0,
} from "../proposals/context-v0";
import type { EvaluationInput } from "../validation/contracts";
import { fingerprint, normalizeVantageOutput, parseEvaluationInput } from "../validation/input";

export const V21_EVALUATION_ADAPTER_VERSION = "vantage-v21-evaluation-bridge/v1" as const;
const reference = z.union([
    z.string().min(1),
    z
        .object({
            kind: z.enum(["ev", "obs", "cm", "doc", "company", "public"]),
            id: z.string().min(1),
            version: z.string().min(1),
        })
        .strict(),
]);
const recommendation = z
    .object({
        call: z.string().min(1).max(140),
        confidence: z.enum(["low", "medium", "high"]),
        because: z.string().min(1).max(240),
        refs: z.array(reference).min(1).max(4),
        wouldChangeIf: z.string().min(1).max(160),
    })
    .strict();
const keyFigure = z
    .object({
        label: z.string().min(1).max(32),
        value: z.string().min(1).max(32),
        tone: z.enum(["neutral", "concern", "positive"]),
        refs: z.array(reference).min(1).max(3),
        derivation: z
            .object({
                op: z.enum(["difference", "sum", "ratio", "count"]),
                inputs: z
                    .array(z.object({ value: z.number().finite(), ref: reference }).strict())
                    .min(1)
                    .max(8),
            })
            .strict()
            .optional(),
    })
    .strict();
const reportSchema = z
    .object({
        headline: z.string().min(1).max(120),
        brief: z.string().min(1).max(300),
        keyFigures: z.array(keyFigure).max(3),
        topics: z
            .array(
                z
                    .object({
                        whyNow: z.string().min(1).max(160),
                        recommendation: recommendation.nullable(),
                    })
                    .passthrough()
            )
            .max(3),
    })
    .passthrough();

type Reference = z.infer<typeof reference>;
export interface V21SourceBinding {
    /** Explicit host binding for a raw model alias; never inferred from an ev: string. */
    alias: string;
    ref: ContextSourceRefV0;
}
export interface V21EvaluationUnit {
    fieldPath: string;
    outputId: string;
    category: "factual" | "recommendation" | "presentation" | "temporal-relevance";
    text: string;
    sourceIds: string[];
    refs: ContextSourceRefV0[];
    support: "exact-reference-only" | "no-explicit-field-citations";
    semanticStatus: "unassessed";
}
export interface V21EvaluationBridge {
    version: typeof V21_EVALUATION_ADAPTER_VERSION;
    originalInputFingerprint: string;
    originalOutputFingerprint: string;
    roleContextFingerprint: string;
    supplementaryInputFingerprint: string;
    originalFields: {
        headline: string;
        brief: string;
        keyFigures: z.infer<typeof keyFigure>[];
        topics: { whyNow: string; recommendation: z.infer<typeof recommendation> | null }[];
    };
    /** A retained caller-supplied declaration, never an authentication or ACL decision. */
    roleContext: BusinessRoleContextV0;
    roleTransport: {
        field: "scenario.title";
        alreadyIncludedByCaller: boolean;
        originalTitle: string;
    };
    units: V21EvaluationUnit[];
    limitations: string[];
    /** Separate evaluation-only projection. Never persist this as a Vantage report. */
    supplementaryInput: EvaluationInput;
}

/**
 * Preserve the V2 additions and expose their exact text to Sophia's unchanged
 * evaluator. Enhancement nodes are transport addresses, not new product advice.
 * This function neither judges meaning nor invokes a provider.
 */
export function adaptV21Evaluation(
    raw: unknown,
    options: {
        input: EvaluationInput;
        roleContext: BusinessRoleContextV0;
        sourceBindings?: readonly V21SourceBinding[];
        /** The Joseph bridge can already transport the same role declaration in this title. */
        roleMetadataAlreadyIncluded?: boolean;
    }
): V21EvaluationBridge {
    const input = parseEvaluationInput(options.input);
    const candidate =
        raw && typeof raw === "object"
            ? "report" in raw
                ? raw.report
                : "experimental" in raw
                  ? raw.experimental
                  : raw
            : raw;
    const parsed = reportSchema.safeParse(candidate);
    if (!parsed.success)
        throw new Error("Expected bounded V2.1 contextual fields; nothing was truncated.");
    const original = parsed.data;
    const documents = new Map(input.scenario.documents.map(doc => [doc.id, doc]));
    const aliases = new Map<string, ContextSourceRefV0>();
    for (const binding of options.sourceBindings ?? []) {
        if (aliases.has(binding.alias)) throw new Error("Duplicate explicit V2 source alias.");
        const ref = reference.parse(binding.ref);
        if (typeof ref === "string")
            throw new Error("Source alias requires an exact typed reference.");
        aliases.set(binding.alias, ref);
    }
    const resolveReference = (value: Reference): ContextSourceRefV0 => {
        const ref = typeof value === "string" ? aliases.get(value) : value;
        if (!ref)
            throw new Error(
                "Unbound V2 citation alias; provide an explicit exact-version binding."
            );
        const sourceId = contextSourceKeyV0(ref);
        const doc = documents.get(sourceId);
        if (!doc || doc.version !== ref.version)
            throw new Error("V2 citation does not match an exact scenario source/version.");
        return structuredClone(ref);
    };
    // Only known citation fields are resolved. Original output and native report
    // objects are never edited, and aliases never become fake Contract v1 refs.
    const canonical = structuredClone(candidate) as Record<string, unknown>;
    const topics = canonical.topics as Array<Record<string, unknown>>;
    for (const topic of topics) {
        for (const field of ["facts", "conflicts"] as const) {
            const facts = z
                .array(z.object({ refs: z.array(reference) }).passthrough())
                .parse(topic[field]);
            topic[field] = facts.map(fact => ({ ...fact, refs: fact.refs.map(resolveReference) }));
        }
    }
    if (canonical.enhancements !== undefined) {
        const enhancements = z
            .array(z.object({ refs: z.array(reference) }).passthrough())
            .parse(canonical.enhancements);
        canonical.enhancements = enhancements.map(item => ({
            ...item,
            refs: item.refs.map(resolveReference),
        }));
    }
    const actual = normalizeVantageOutput(canonical, {
        id: input.actual.id,
        pipelineVersion: input.actual.pipelineVersion,
    });
    // A candidate label is not a content identity. Bind the existing evaluation
    // body before adding V2 transport nodes; never substitute another report's
    // summary, tasks or citations under the caller's candidate ID.
    if (fingerprint(actual) !== fingerprint(input.actual))
        throw new Error(
            "V2 output belongs to a different candidate than the supplied evaluation body."
        );
    const units: V21EvaluationUnit[] = [];
    const add = (
        fieldPath: string,
        category: V21EvaluationUnit["category"],
        text: string,
        values: Reference[] = [],
        topicId = "v21-report"
    ) => {
        const refs = values.map(resolveReference);
        const sourceIds = [...new Set(refs.map(contextSourceKeyV0))];
        const id = `v21-${fieldPath.replace(/[^a-zA-Z0-9-]/g, "-")}`;
        const kind = category === "factual" ? "evidence" : "idea";
        actual.enhancements.push({ id, topicId, kind, text, rationale: "", sourceIds });
        units.push({
            fieldPath,
            outputId: `enhancement/${id}/${kind}`,
            category,
            text,
            sourceIds,
            refs,
            support: sourceIds.length ? "exact-reference-only" : "no-explicit-field-citations",
            semanticStatus: "unassessed",
        });
    };
    add("headline", "presentation", original.headline);
    add("brief", "presentation", original.brief);
    original.keyFigures.forEach((figure, index) => {
        const { refs, ...presentation } = figure;
        // Derivation inputs carry their own refs and must not evade version checks.
        const figureRefs = new Set(refs.map(resolveReference).map(contextSourceKeyV0));
        for (const item of figure.derivation?.inputs ?? []) {
            if (!figureRefs.has(contextSourceKeyV0(resolveReference(item.ref))))
                throw new Error(
                    "V2 derivation inputs must belong to the figure's declared exact references."
                );
        }
        add(`keyFigures[${index}]`, "factual", JSON.stringify(presentation), refs);
    });
    original.topics.forEach((topic, index) => {
        const topicId = actual.tasks[index]!.id;
        add(`topics[${index}].whyNow`, "temporal-relevance", topic.whyNow, [], topicId);
        if (topic.recommendation) {
            for (const field of ["call", "because", "wouldChangeIf", "confidence"] as const)
                add(
                    `topics[${index}].recommendation.${field}`,
                    "recommendation",
                    topic.recommendation[field],
                    topic.recommendation.refs,
                    topicId
                );
        }
    });
    const roleContext = structuredClone(options.roleContext);
    const roleText = JSON.stringify({
        roleIds: roleContext.roleIds,
        primaryRoleId: roleContext.primaryRoleId ?? null,
        mappingVersion: roleContext.mappingVersion,
        provenance: roleContext.provenance,
        userConfirmed: roleContext.userConfirmed,
        fallback: roleContext.fallback,
    });
    const supplementaryInput = parseEvaluationInput({
        ...input,
        scenario: {
            ...input.scenario,
            title: options.roleMetadataAlreadyIncluded
                ? input.scenario.title
                : `${input.scenario.title}\nEvaluation role context (metadata, not source evidence or authorization): ${roleText}`,
        },
        actual,
    });
    return {
        version: V21_EVALUATION_ADAPTER_VERSION,
        originalInputFingerprint: fingerprint(input),
        originalOutputFingerprint: fingerprint(raw),
        roleContextFingerprint: fingerprint(roleContext),
        supplementaryInputFingerprint: fingerprint(supplementaryInput),
        originalFields: {
            headline: original.headline,
            brief: original.brief,
            keyFigures: structuredClone(original.keyFigures),
            topics: original.topics.map(topic => ({
                whyNow: topic.whyNow,
                recommendation: structuredClone(topic.recommendation),
            })),
        },
        roleContext,
        roleTransport: {
            field: "scenario.title",
            alreadyIncludedByCaller: options.roleMetadataAlreadyIncluded === true,
            originalTitle: input.scenario.title,
        },
        units,
        limitations: [
            "Citation identity/version checks do not prove semantic entailment or authorization.",
            "Unreferenced headline, brief and whyNow fields have unassessed factual support; no citations were invented.",
            "Supplementary enhancement nodes are evaluation-only transport, not generated suggestions or commitments.",
            "Semantic, recommendation and presentation quality remain unassessed without a valid judge.",
            "Supplementary scores are a separate transport condition, not calibrated against legacy results or the historical 18.6/20 benchmark.",
        ],
        supplementaryInput,
    };
}
