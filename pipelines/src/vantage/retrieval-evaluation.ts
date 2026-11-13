import { createHash } from "node:crypto";

export interface EvaluationEvidence {
    id: string;
    version: string;
    hash: string;
    citation: string;
    companyId: string;
    authorized: boolean;
    availableAt: string;
    text: string;
}

export interface EvaluationGold {
    provenance: "authoritative" | "provisional" | "none";
    /** Reviewable source, reviewer, and revision identifying the judgments. */
    source: string;
    reviewer: string;
    revision: string;
    criticalIds?: readonly string[];
    mandatoryIds?: readonly string[];
    optional?: { poolIds: readonly string[]; relevantIds: readonly string[] };
    decisions?: readonly { id: string; requiredEvidenceIds: readonly string[] }[];
}

export interface RetrievalEvaluationInput {
    corpusId: string;
    corpusVersion: string;
    companyId: string;
    cutoff: string;
    /** Defaults to production/V1 created_at <= cutoff semantics. */
    cutoffInclusive?: boolean;
    query: string;
    topK: number;
    budgets: {
        maxAcquired: number;
        maxSelected: number;
        maxSelectedCharacters: number;
        maxElapsedMs: number;
    };
    corpus: readonly EvaluationEvidence[];
    gold?: EvaluationGold;
}

export interface EvaluationSelection {
    id: string;
    version: string;
    hash: string;
    citation: string;
}

export interface RetrievalEvaluationOutput {
    acquiredIds: readonly string[];
    selected: readonly EvaluationSelection[];
}

export type RetrievalCandidateName =
    | "A-production"
    | "B-budget-v1"
    | "C-exact-sophia-lexical"
    | "D-scoped-candidate";

/** Retrieval code receives this projection. Evaluation judgments remain evaluator-only. */
export type RetrievalCandidateInput = Omit<RetrievalEvaluationInput, "gold">;

export interface RetrievalEvaluationCandidate {
    name: RetrievalCandidateName;
    /** Pin the implementation revision or exact exported source hash. */
    implementation: string;
    run: (
        input: Readonly<RetrievalCandidateInput>,
        signal: AbortSignal
    ) => RetrievalEvaluationOutput | Promise<RetrievalEvaluationOutput>;
}

export interface EvaluationMetric {
    status: "verified" | "unverified" | "invalid-output";
    provenance: EvaluationGold["provenance"];
    numerator: number | null;
    denominator: number | null;
    value: number | null;
}

export interface RetrievalCandidateReport {
    name: RetrievalCandidateName;
    implementation: string;
    status: "valid" | "invalid" | "error";
    output: RetrievalEvaluationOutput | null;
    violations: string[];
    error: string | null;
    /** One wall-clock observation, including callback execution only. */
    elapsedMs: number;
    selectedCharacters: number;
    metrics: {
        criticalEvidenceRecallAtK: EvaluationMetric;
        mandatoryCoverage: EvaluationMetric;
        optionalRelevanceAtK: EvaluationMetric;
        decisionEvidenceCoverage: EvaluationMetric;
    };
}

function freeze<T>(value: T): T {
    if (value && typeof value === "object") {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
}

function assertIds(ids: readonly string[], corpus: ReadonlySet<string>, label: string) {
    if (new Set(ids).size !== ids.length || ids.some(id => !corpus.has(id))) {
        throw new Error(`Invalid gold ${label}: duplicate or unknown evidence ID`);
    }
}

function validateInput(input: RetrievalEvaluationInput) {
    const cutoff = Date.parse(input.cutoff);
    if (!input.corpusId || !input.corpusVersion || !input.companyId || !Number.isFinite(cutoff)) {
        throw new Error("Corpus identity, company, and valid cutoff are required");
    }
    for (const value of [input.topK, ...Object.values(input.budgets)]) {
        if (!Number.isSafeInteger(value) || value < 1) {
            throw new Error("K and all resource caps must be positive safe integers");
        }
    }
    if (input.budgets.maxElapsedMs > 2_147_483_647)
        throw new Error("Elapsed cap exceeds timer range");
    if (input.topK > input.budgets.maxSelected) throw new Error("K exceeds selection cap");
    const ids = new Set<string>();
    for (const evidence of input.corpus) {
        if (
            !evidence.id ||
            !evidence.version ||
            !/^[a-f0-9]{64}$/.test(evidence.hash) ||
            createHash("sha256").update(evidence.text, "utf8").digest("hex") !== evidence.hash ||
            !evidence.citation ||
            ids.has(evidence.id) ||
            !evidence.authorized ||
            evidence.companyId !== input.companyId ||
            !Number.isFinite(Date.parse(evidence.availableAt)) ||
            (input.cutoffInclusive === false
                ? Date.parse(evidence.availableAt) >= cutoff
                : Date.parse(evidence.availableAt) > cutoff)
        ) {
            throw new Error(
                `Corpus must contain unique, authorized, cutoff-eligible exact evidence: ${evidence.id}`
            );
        }
        ids.add(evidence.id);
    }
    const gold = input.gold;
    if (!gold || gold.provenance === "none") return;
    if (
        !["authoritative", "provisional"].includes(gold.provenance) ||
        !gold.source.trim() ||
        !gold.reviewer.trim() ||
        !gold.revision.trim()
    ) {
        throw new Error("Gold judgments require reviewable provenance");
    }
    assertIds(gold.criticalIds ?? [], ids, "criticalIds");
    assertIds(gold.mandatoryIds ?? [], ids, "mandatoryIds");
    if (gold.optional) {
        assertIds(gold.optional.poolIds, ids, "optional.poolIds");
        assertIds(
            gold.optional.relevantIds,
            new Set(gold.optional.poolIds),
            "optional.relevantIds"
        );
    }
    const decisions = new Set<string>();
    for (const decision of gold.decisions ?? []) {
        if (!decision.id || decisions.has(decision.id) || !decision.requiredEvidenceIds.length) {
            throw new Error("Gold decision IDs must be unique with explicit required evidence");
        }
        decisions.add(decision.id);
        assertIds(decision.requiredEvidenceIds, ids, "decisions");
    }
}

function metrics(
    input: RetrievalEvaluationInput,
    output: RetrievalEvaluationOutput | null,
    invalid: boolean
) {
    const gold = input.gold;
    const selected = new Set(output?.selected.map(item => item.id));
    const atK = new Set(output?.selected.slice(0, input.topK).map(item => item.id));
    const measure = (
        numerator: number,
        denominator: number,
        labeled: boolean
    ): EvaluationMetric => {
        const provenance = gold?.provenance ?? "none";
        if (invalid || !labeled || provenance === "none" || denominator === 0) {
            return {
                status: invalid ? "invalid-output" : "unverified",
                provenance,
                numerator: null,
                denominator: null,
                value: null,
            };
        }
        return {
            status: "verified",
            provenance,
            numerator,
            denominator,
            value: numerator / denominator,
        };
    };
    const critical = gold?.criticalIds ?? [];
    const mandatory = gold?.mandatoryIds ?? [];
    const optional = gold?.optional;
    const optionalSelected = optional?.poolIds.filter(id => atK.has(id)) ?? [];
    const decisions = gold?.decisions ?? [];
    return {
        criticalEvidenceRecallAtK: measure(
            critical.filter(id => atK.has(id)).length,
            critical.length,
            gold?.criticalIds !== undefined
        ),
        mandatoryCoverage: measure(
            mandatory.filter(id => selected.has(id)).length,
            mandatory.length,
            gold?.mandatoryIds !== undefined
        ),
        optionalRelevanceAtK: measure(
            optional?.relevantIds.filter(id => atK.has(id)).length ?? 0,
            optionalSelected.length,
            optional !== undefined
        ),
        decisionEvidenceCoverage: measure(
            decisions.filter(decision => decision.requiredEvidenceIds.every(id => selected.has(id)))
                .length,
            decisions.length,
            gold?.decisions !== undefined
        ),
    };
}

/** Offline callback harness. Callbacks must honor resource caps while executing.
 * The deadline bounds asynchronous awaiting and signals cancellation. Underlying work
 * must cooperate with AbortSignal. Synchronous JavaScript cannot be preempted.
 * Selection order defines K. Decision coverage requires every explicitly labeled evidence ID.
 */
export async function evaluateRetrievalOffline(
    input: RetrievalEvaluationInput,
    candidates: readonly RetrievalEvaluationCandidate[]
) {
    const frozen = freeze(
        structuredClone({ ...input, cutoffInclusive: input.cutoffInclusive ?? true })
    );
    validateInput(frozen);
    if (
        new Set(candidates.map(candidate => candidate.name)).size !== candidates.length ||
        candidates.some(candidate => !candidate.implementation.trim())
    ) {
        throw new Error("Candidates require unique names and pinned implementations");
    }
    // Explicit projection also excludes unexpected runtime metadata from candidate inputs.
    const candidateInput: RetrievalCandidateInput = freeze(
        structuredClone({
            corpusId: frozen.corpusId,
            corpusVersion: frozen.corpusVersion,
            companyId: frozen.companyId,
            cutoff: frozen.cutoff,
            cutoffInclusive: frozen.cutoffInclusive,
            query: frozen.query,
            topK: frozen.topK,
            budgets: {
                maxAcquired: frozen.budgets.maxAcquired,
                maxSelected: frozen.budgets.maxSelected,
                maxSelectedCharacters: frozen.budgets.maxSelectedCharacters,
                maxElapsedMs: frozen.budgets.maxElapsedMs,
            },
            corpus: frozen.corpus.map(
                ({ id, version, hash, citation, companyId, authorized, availableAt, text }) => ({
                    id,
                    version,
                    hash,
                    citation,
                    companyId,
                    authorized,
                    availableAt,
                    text,
                })
            ),
        })
    );
    const corpus = new Map(frozen.corpus.map(evidence => [evidence.id, evidence]));
    const reports: RetrievalCandidateReport[] = [];
    for (const candidate of candidates) {
        const started = performance.now();
        let output: RetrievalEvaluationOutput | null = null;
        let error: string | null = null;
        let selectedCharacters = 0;
        const violations: string[] = [];
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const deadline = new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                    violations.push("callback-timeout");
                    const timeout = new Error("retrieval_evaluation_timeout");
                    controller.abort(timeout);
                    reject(timeout);
                }, frozen.budgets.maxElapsedMs);
            });
            output = structuredClone(
                await Promise.race([
                    Promise.resolve().then(() => candidate.run(candidateInput, controller.signal)),
                    deadline,
                ])
            );
            const acquired = new Set(output.acquiredIds);
            if (acquired.size !== output.acquiredIds.length)
                violations.push("duplicate-acquisition");
            if (output.acquiredIds.length > frozen.budgets.maxAcquired)
                violations.push("acquisition-cap");
            for (const id of acquired) {
                if (!corpus.has(id)) violations.push(`acquired-outside-authorized-corpus:${id}`);
            }
            if (output.selected.length > frozen.budgets.maxSelected)
                violations.push("selection-cap");
            const seen = new Set<string>();
            for (const item of output.selected) {
                if (seen.has(item.id)) violations.push(`duplicate-selection:${item.id}`);
                seen.add(item.id);
                if (!acquired.has(item.id))
                    violations.push(`selected-without-acquisition:${item.id}`);
                const evidence = corpus.get(item.id);
                if (!evidence) {
                    violations.push(`selected-outside-authorized-corpus:${item.id}`);
                    continue;
                }
                selectedCharacters += evidence.text.length;
                if (item.version !== evidence.version)
                    violations.push(`version-mismatch:${item.id}`);
                if (item.hash !== evidence.hash) violations.push(`hash-mismatch:${item.id}`);
                if (item.citation !== evidence.citation)
                    violations.push(`citation-mismatch:${item.id}`);
            }
            if (selectedCharacters > frozen.budgets.maxSelectedCharacters)
                violations.push("character-cap");
        } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
            output = null;
        } finally {
            if (timer !== undefined) clearTimeout(timer);
        }
        const elapsedMs = performance.now() - started;
        if (elapsedMs > frozen.budgets.maxElapsedMs) violations.push("elapsed-cap");
        const invalid = error !== null || violations.length > 0;
        reports.push({
            name: candidate.name,
            implementation: candidate.implementation,
            status: error ? "error" : invalid ? "invalid" : "valid",
            output,
            violations,
            error,
            elapsedMs,
            selectedCharacters,
            metrics: metrics(frozen, output, invalid),
        });
    }
    return {
        schemaVersion: "vantage-retrieval-offline/v1" as const,
        evidenceMode: "offline-callback" as const,
        manifestSha256: createHash("sha256").update(JSON.stringify(frozen)).digest("hex"),
        manifest: frozen,
        candidates: reports,
    };
}
