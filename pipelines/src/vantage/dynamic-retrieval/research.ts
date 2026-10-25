import {
    contextSourceKeyV0 as key,
    validateContextResearchPlan,
    validateContextResearchResult,
    validateDynamicRetrievalBundle,
    validateDynamicRetrievalInput,
    validateRequiredContextBundle,
    type ContextResearchPlanV0,
    type ContextResearchResultV0,
    type ContextSourceEntryV0,
    type ContextSourceRefV0,
    type ContextScopeV0,
    type PublicCitationV0,
    type PublicSafeQueryProjectionV0,
} from "../proposals/context-v0";
import { ContextPortErrorV0, type ContextAssemblyInputV0 } from "../context-v0/ports";
import {
    boundedCall,
    checkBudgets,
    compareText,
    SearchTimeout,
    terms,
    tokenCeiling,
} from "./bounds";

/** Explicit questions make this prototype's sufficiency policy testable, not a truth claim. */
export interface ResearchQuestionV0 {
    id: string;
    question: string;
    /** All terms must occur in prepared context before this gap is considered covered. */
    requiredTerms: string[];
    publicProjectionIds?: string[];
}

export function createContextResearchPlannerV0(options: {
    questions: readonly ResearchQuestionV0[];
    approvedPublicQueries?: readonly PublicSafeQueryProjectionV0[];
}) {
    if (
        options.questions.length > 32 ||
        options.questions.some(
            q => !q.id || !q.question || !terms(q.requiredTerms.join(" ")).length
        )
    )
        throw new ContextPortErrorV0(
            "Research requires at most 32 explicit bounded gap questions.",
            400
        );
    return (input: ContextAssemblyInputV0): ContextResearchPlanV0 => {
        const actor = input.requiredContext.actor;
        const scope = {
            expectedCompanyId: actor.companyId,
            expectedPrincipalRef: actor.principalRef,
            expectedAclDigest: actor.aclDigest,
        };
        if (
            !input.retrievalInput ||
            input.retrievalInput.sourceCatalog.length > 2000 ||
            input.requiredContext.asOf !== input.reportWindow.asOf ||
            [input.retrievalInput.reportWindow, input.retrieval.reportWindow].some(
                window =>
                    window.asOf !== input.reportWindow.asOf ||
                    window.startInclusive !== input.reportWindow.startInclusive ||
                    window.endExclusive !== input.reportWindow.endExclusive
            ) ||
            !validateDynamicRetrievalInput(input.retrievalInput, scope).ok ||
            !validateRequiredContextBundle(input.requiredContext, scope).ok ||
            input.requiredContext.status !== "complete" ||
            !validateDynamicRetrievalBundle(input.retrieval, input.retrievalInput, scope).ok
        )
            throw new ContextPortErrorV0("Research requires authorized prepared context.", 403);
        checkBudgets(input.budgets);
        const prepared = [
            input.requiredContext.companyArchitecture,
            ...input.requiredContext.workspaceMandatoryDocuments,
            ...input.requiredContext.personalVantageStars,
            ...input.retrieval.sourceRegistry,
        ];
        const used = new Set(prepared.map(entry => key(entry.source)));
        const text = [...new Map(prepared.map(entry => [key(entry.source), entry])).values()]
            .map(entry => entry.excerpt)
            .join("\n");
        // Do not inspect arbitrarily large private context even in the deterministic planner.
        if (
            text.length > input.budgets.maxExcerptChars ||
            tokenCeiling(text) > input.budgets.maxTokens
        )
            return stop("Prepared context exceeds the research reading budget.");
        const covered = new Set(terms(text));
        const plan: ContextResearchPlanV0 = {
            contractVersion: "v0-proposed",
            mode: "STOP",
            gapPurpose: "Prepared context covers the configured questions.",
            internalSourceRefs: [],
            publicSafeQueryProjection: [],
            budgets: { ...input.budgets },
        };
        function stop(reason: string): ContextResearchPlanV0 {
            return {
                contractVersion: "v0-proposed",
                mode: "STOP",
                gapPurpose: reason,
                internalSourceRefs: [],
                publicSafeQueryProjection: [],
                budgets: { ...input.budgets },
            };
        }
        if (
            !input.budgets.maxQueries ||
            !input.budgets.maxSources ||
            !input.budgets.timeoutMs ||
            !input.budgets.maxTokens
        )
            return stop("No optional research budget remains.");
        for (const gap of [...options.questions].sort((a, b) => compareText(a.id, b.id))) {
            const missing = terms(gap.requiredTerms.join(" ")).filter(term => !covered.has(term));
            if (!missing.length) continue;
            const internal = input.retrievalInput.sourceCatalog
                .filter(
                    entry =>
                        entry.access === "allowed" &&
                        entry.source.kind !== "public" &&
                        !used.has(key(entry.source)) &&
                        entry.companyId === actor.companyId &&
                        Date.parse(entry.sourceDate) <= Date.parse(input.reportWindow.asOf) &&
                        (entry.audience.kind === "company"
                            ? entry.audience.companyId === actor.companyId
                            : entry.audience.kind === "actor" &&
                              entry.audience.principalRef === actor.principalRef)
                )
                .filter(entry => missing.some(term => terms(entry.excerpt).includes(term)))
                .sort((a, b) => compareText(key(a.source), key(b.source)));
            if (internal.length) {
                plan.mode = "internal";
                plan.gapPurpose = gap.question;
                plan.internalSourceRefs = internal
                    .slice(0, Math.min(input.budgets.maxQueries, input.budgets.maxSources))
                    .map(entry => entry.source);
                return plan;
            }
            const projections = (options.approvedPublicQueries ?? [])
                .filter(p => gap.publicProjectionIds?.includes(p.projectionId))
                .sort((a, b) => compareText(a.projectionId, b.projectionId))
                .slice(0, input.budgets.maxQueries);
            if (projections.length) {
                plan.mode = "public";
                plan.gapPurpose = "Approved public context lookup";
                // Never interpolate the private question or prepared context into public queries.
                plan.publicSafeQueryProjection = projections.map(p => ({
                    projectionId: p.projectionId,
                    query: p.query,
                    purpose: "Approved public context lookup",
                    approvalToken: p.approvalToken,
                    validatedAt: p.validatedAt,
                }));
                if (
                    !validateContextResearchPlan(plan, {
                        trustedPublicProjections: options.approvedPublicQueries,
                    }).ok
                )
                    throw new ContextPortErrorV0("Public research projection is invalid.", 403);
                return plan;
            }
            return stop(
                "A context gap has no authorized research source or approved public query."
            );
        }
        return plan;
    };
}

export interface ContextResearchToolsV0 {
    /** Exact authorized refs only; the server adapter owns database permissions. */
    internal?: (input: {
        actor: ContextScopeV0;
        source: ContextSourceRefV0;
        signal: AbortSignal;
    }) => Promise<ContextSourceRefV0[]>;
    /** Only public-safe query text is sent to this tool. No actor, context, credentials or gap text. */
    public?: (input: {
        query: string;
        limit: number;
        signal: AbortSignal;
    }) => Promise<PublicCitationV0[]>;
}

export interface BoundedResearchResultV0 extends ContextResearchResultV0 {
    usage: { attemptedQueries: number; excerptChars: number; tokenUpperBound: number };
}

export function createContextResearchProviderV0(options: {
    actor: ContextScopeV0;
    asOf: string;
    /** Authoritative records supplied by the server, never promoted from tool output. */
    catalog: readonly ContextSourceEntryV0[];
    publicCitations?: readonly PublicCitationV0[];
    approvedPublicQueries?: readonly PublicSafeQueryProjectionV0[];
    tools?: ContextResearchToolsV0;
    signal?: AbortSignal;
}) {
    return {
        async research(rawPlan: ContextResearchPlanV0): Promise<BoundedResearchResultV0> {
            const started = performance.now();
            checkBudgets(rawPlan.budgets);
            if (
                !validateContextResearchPlan(rawPlan, {
                    trustedPublicProjections: options.approvedPublicQueries,
                }).ok
            )
                throw new ContextPortErrorV0("Research plan is invalid or not approved.", 403);
            const plan = structuredClone(rawPlan);
            const result: BoundedResearchResultV0 = {
                contractVersion: "v0-proposed",
                mode: plan.mode,
                gapPurpose:
                    plan.mode === "public" ? "Approved public context lookup" : plan.gapPurpose,
                publicSafeQueryProjection:
                    plan.mode === "public"
                        ? plan.publicSafeQueryProjection.map(p => ({
                              projectionId: p.projectionId,
                              query: p.query,
                              approvalToken: p.approvalToken,
                              validatedAt: p.validatedAt,
                              purpose: "Approved public context lookup",
                          }))
                        : [],
                internalSourceRefs: [],
                citations: [],
                failures: [],
                status: plan.mode === "STOP" ? "stopped" : "complete",
                asOf: options.asOf,
                usage: { attemptedQueries: 0, excerptChars: 0, tokenUpperBound: 0 },
            };
            if (plan.mode === "STOP") return result;
            const catalog = new Map(
                options.catalog
                    .filter(
                        entry =>
                            entry.access === "allowed" &&
                            entry.companyId === options.actor.companyId &&
                            Date.parse(entry.sourceDate) <= Date.parse(options.asOf) &&
                            (entry.audience.kind === "public"
                                ? entry.source.kind === "public"
                                : entry.audience.kind === "company"
                                  ? entry.audience.companyId === options.actor.companyId
                                  : entry.audience.principalRef === options.actor.principalRef)
                    )
                    .map(entry => [key(entry.source), entry])
            );
            const requested =
                plan.mode === "internal" ? plan.internalSourceRefs : plan.publicSafeQueryProjection;
            let chars = 0,
                tokens = 0,
                queries = 0;
            const accept = (entry: ContextSourceEntryV0) => {
                const cost = tokenCeiling(entry.excerpt);
                if (
                    result.internalSourceRefs.length + result.citations.length >=
                        plan.budgets.maxSources ||
                    chars + entry.excerpt.length > plan.budgets.maxExcerptChars ||
                    tokens + cost > plan.budgets.maxTokens
                )
                    return false;
                chars += entry.excerpt.length;
                tokens += cost;
                return true;
            };
            for (const request of requested) {
                const remaining = plan.budgets.timeoutMs - (performance.now() - started);
                if (
                    queries >= plan.budgets.maxQueries ||
                    !plan.budgets.maxSources ||
                    !plan.budgets.maxTokens ||
                    !plan.budgets.maxExcerptChars
                ) {
                    result.status = "partial";
                    break;
                }
                try {
                    if (remaining <= 0 || options.signal?.aborted) throw new SearchTimeout();
                    queries++;
                    if (plan.mode === "internal") {
                        const ref = request as ContextSourceRefV0;
                        const entry = catalog.get(key(ref));
                        if (!entry || entry.source.kind === "public")
                            throw new ContextPortErrorV0("Internal source is unavailable.", 403);
                        if (!options.tools?.internal) throw new Error("Unavailable");
                        const found = await boundedCall(
                            signal =>
                                options.tools!.internal!({
                                    actor: structuredClone(options.actor),
                                    source: structuredClone(ref),
                                    signal,
                                }),
                            remaining,
                            options.signal
                        );
                        if (found.length !== 1 || key(found[0]!) !== key(ref))
                            throw new Error("Invalid internal result");
                        if (!result.internalSourceRefs.some(r => key(r) === key(ref))) {
                            if (accept(entry)) result.internalSourceRefs.push(entry.source);
                            else result.status = "partial";
                        }
                    } else {
                        const projection = request as PublicSafeQueryProjectionV0;
                        if (!options.tools?.public) throw new Error("Unavailable");
                        if (tokens + tokenCeiling(projection.query) > plan.budgets.maxTokens) {
                            result.status = "partial";
                            break;
                        }
                        tokens += tokenCeiling(projection.query);
                        const found = await boundedCall(
                            signal =>
                                options.tools!.public!({
                                    query: projection.query,
                                    limit: plan.budgets.maxSources,
                                    signal,
                                }),
                            remaining,
                            options.signal
                        );
                        if (found.length > plan.budgets.maxSources)
                            throw new Error("Invalid public result size");
                        for (const citation of found) {
                            const canonical = options.publicCitations?.find(
                                c => key(c.source) === key(citation.source)
                            );
                            const entry = canonical && catalog.get(key(canonical.source));
                            if (
                                !canonical ||
                                !entry ||
                                entry.source.kind !== "public" ||
                                canonical.url !== citation.url ||
                                !/^https:\/\//i.test(canonical.url) ||
                                Date.parse(canonical.sourceDate) > Date.parse(options.asOf)
                            ) {
                                result.failures.push({
                                    code: "invalid_source",
                                    message: "Public source is not registered and validated.",
                                });
                                continue;
                            }
                            if (
                                !result.citations.some(c => key(c.source) === key(canonical.source))
                            ) {
                                if (accept(entry))
                                    result.citations.push(structuredClone(canonical));
                                else result.status = "partial";
                            }
                        }
                    }
                } catch (error) {
                    result.failures.push({
                        code: error instanceof SearchTimeout ? "timeout" : "source_unavailable",
                        message: "Optional research could not complete.",
                    });
                    if (error instanceof SearchTimeout) break;
                }
            }
            if (result.failures.length)
                result.status =
                    result.citations.length + result.internalSourceRefs.length
                        ? "partial"
                        : "failed";
            result.usage = {
                attemptedQueries: queries,
                excerptChars: chars,
                tokenUpperBound: tokens,
            };
            if (
                !validateContextResearchResult(result, plan, {
                    trustedPublicProjections: options.approvedPublicQueries,
                }).ok
            )
                throw new ContextPortErrorV0("Research result failed validation.", 500);
            return result;
        },
    };
}
