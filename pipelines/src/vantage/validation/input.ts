import { createHash } from "node:crypto";
import { z } from "zod";
import {
    VersionedEvaluationInputSchema,
    ScopedEvidenceDependencySchema,
    EVALUATION_VERSION,
    LEGACY_SCOPED_EVALUATION_VERSION,
    SCOPED_EVALUATION_VERSION,
    type ScopedEvidenceDependency,
    type EvaluationInput,
    type OutputUnit,
} from "./contracts";
type ContextSourceRefV0 = { kind: string; id: string; version: string };
const contextSourceKeyV0 = (ref: ContextSourceRefV0) => `${ref.kind}:${ref.id}@${ref.version}`;

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
    const parsed = VersionedEvaluationInputSchema.safeParse(raw);
    if (!parsed.success)
        throw new Error(
            "Invalid evaluation input. Use the versioned scenario/expectation/output schema."
        );
    const input = parsed.data;
    if (input.version !== EVALUATION_VERSION) {
        validateScopedCoverage(
            input.scenario.scopedEvidence,
            input.scenario.documents,
            input.scenario.asOf
        );
        // V2 replays retain their original critical gate for every scoped unit.
        // V3 binds every unit above and applies semantic criticality by source purpose.
        const requiredRefs =
            input.version === LEGACY_SCOPED_EVALUATION_VERSION
                ? input.scenario.scopedEvidence.flatMap(proof =>
                      proof.requiredUnits.map(
                          unit => proof.units.find(included => included.id === unit.id)!.ref
                      )
                  )
                : input.scenario.documents
                      .filter(doc =>
                          ["company-architecture", "workspace-required"].includes(doc.purpose)
                      )
                      .map(doc => doc.id);
        for (const ref of requiredRefs) {
            if (
                !input.scenario.expectations.some(
                    expected =>
                        expected.kind === "must_include" &&
                        expected.importance === "critical" &&
                        expected.evidence.some(evidence => evidence.sourceId === ref)
                )
            )
                throw new Error(
                    input.version === LEGACY_SCOPED_EVALUATION_VERSION
                        ? "Every required scoped unit needs a critical semantic coverage expectation."
                        : "Every company-required source needs a critical semantic coverage expectation."
                );
        }
        if (input.version === SCOPED_EVALUATION_VERSION) {
            const required = new Set(requiredRefs);
            if (
                input.scenario.expectations.some(
                    expected =>
                        expected.kind === "must_include" &&
                        expected.importance === "critical" &&
                        !expected.evidence.some(evidence => required.has(evidence.sourceId))
                )
            )
                throw new Error(
                    "Critical semantic coverage expectations require a company-required source."
                );
        }
    }
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

/** Deterministic binding checks. Live authority and full-parent revalidation remain host-owned. */
export function validateScopedCoverage(
    rawProofs: readonly ScopedEvidenceDependency[],
    documents: readonly {
        id: string;
        version: string;
        hash: string;
        purpose: string;
        availableAt?: string;
        text: string;
    }[],
    asOf: string
): void {
    const proofs = z.array(ScopedEvidenceDependencySchema).min(1).max(16).parse(rawProofs);
    const assert = (condition: unknown, code: string) => {
        if (!condition) throw new Error(code);
    };
    const hashText = (value: string) => createHash("sha256").update(value).digest("hex");
    const hashValue = (value: unknown) => hashText(JSON.stringify(value));
    assert(new Set(documents.map(doc => doc.id)).size === documents.length, "duplicate_source_ref");
    assert(
        new Set(proofs.map(proof => proof.documentId)).size === proofs.length,
        "duplicate_scoped_parent"
    );
    const actor = proofs[0]!.actorId;
    const company = proofs[0]!.companyId;
    const units = new Map<string, ScopedEvidenceDependency["units"][number]>();
    for (const proof of proofs) {
        assert(
            proof.actorId === actor && proof.companyId === company,
            "scoped_authority_identity_mismatch"
        );
        assert(
            proof.audience === (proof.companyReadable ? "company" : "actor"),
            "authority_audience_mismatch"
        );
        assert(
            !["company-architecture", "workspace-required"].includes(proof.purpose) ||
                proof.companyReadable,
            "required_context_audience"
        );
        assert(
            Date.parse(proof.versionDate) <= Date.parse(asOf) &&
                Date.parse(proof.availableAt) <= Date.parse(asOf),
            "future_parent_version"
        );
        assert(
            proof.coverage.state !== "insufficient_evidence" &&
                proof.coverage.requiredUnits === proof.requiredUnits.length &&
                proof.coverage.includedUnits === proof.units.length &&
                proof.units.length === proof.requiredUnits.length,
            "required_scope_incomplete"
        );
        assert(
            new Set(proof.requiredUnits.map(unit => unit.id)).size === proof.requiredUnits.length &&
                new Set(proof.units.map(unit => unit.id)).size === proof.units.length,
            "duplicate_unit"
        );
        const expectedScopeHash = hashValue({
            actorId: proof.actorId,
            purpose: proof.purpose,
            audience: proof.audience,
            companyReadable: proof.companyReadable,
            authorityRevision: proof.authorityRevision,
            qualification: proof.coverage.qualification,
            inventory: proof.requiredUnits,
        });
        assert(expectedScopeHash === proof.scopeHash, "scope_hash_mismatch");
        for (let i = 0; i < proof.requiredUnits.length; i++) {
            const required = proof.requiredUnits[i]!;
            assert(
                required.start < required.end &&
                    required.end <= proof.parentChars &&
                    required.end - required.start <= 6000 &&
                    (i === 0 || proof.requiredUnits[i - 1]!.end <= required.start),
                "invalid_scope_range"
            );
            const unit = proof.units[i]!;
            assert(
                unit.id === required.id &&
                    unit.start === required.start &&
                    unit.end === required.end &&
                    unit.excerptHash === required.excerptHash,
                "required_unit_mismatch"
            );
            const expectedRef = `unit:${hashValue([proof.documentId, proof.parentVersion, proof.parentHash, proof.scopeHash, unit.id])}`;
            assert(unit.ref === expectedRef && !units.has(unit.ref), "invalid_scoped_ref");
            const doc = documents.find(doc => doc.id === unit.ref);
            assert(
                doc &&
                    doc.version === proof.parentVersion &&
                    doc.hash === unit.excerptHash &&
                    doc.purpose === proof.purpose &&
                    doc.text.length === unit.end - unit.start &&
                    hashText(doc.text) === unit.excerptHash,
                "scoped_source_mismatch"
            );
            assert(
                doc!.availableAt === undefined || doc!.availableAt === proof.availableAt,
                "scoped_source_date_mismatch"
            );
            assert(
                unit.anchors.reduce((sum, anchor) => sum + anchor.end - anchor.start, 0) ===
                    unit.end - unit.start &&
                    unit.anchors.every(
                        (anchor, index) =>
                            anchor.start < anchor.end &&
                            (index === 0 || anchor.ordinal === unit.anchors[index - 1]!.ordinal + 1)
                    ),
                "invalid_chunk_anchors"
            );
            units.set(unit.ref, unit);
        }
        if (proof.coverage.state === "full_document_reviewed") {
            assert(
                proof.requiredUnits[0]!.start === 0 &&
                    proof.requiredUnits.at(-1)!.end === proof.parentChars &&
                    proof.requiredUnits.every(
                        (unit, i) => i === 0 || proof.requiredUnits[i - 1]!.end === unit.start
                    ),
                "invalid_full_document_coverage"
            );
            const fullText = proof.units
                .map(unit => documents.find(doc => doc.id === unit.ref)!.text)
                .join("");
            assert(hashText(fullText) === proof.parentHash, "parent_hash_mismatch");
        }
    }
    assert(
        documents.filter(doc => doc.id.startsWith("unit:")).every(doc => units.has(doc.id)) &&
            documents.filter(doc => units.has(doc.id)).length === units.size,
        "unbound_scoped_source"
    );
}

/** Exact human-message payload used by the model Judge. Shared with scoped admission. */
export function judgeInputPayload(input: EvaluationInput): string {
    return JSON.stringify({
        scenario: input.scenario,
        candidate: { id: input.actual.id, pipelineVersion: input.actual.pipelineVersion },
        outputUnits: outputUnits(input),
    });
}
