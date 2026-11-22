import {
    calculateWeeklyReviewBudget,
    type WeeklyReviewInput,
} from "@launchstack/pipelines/vantage/weekly-review-v21";
import { fingerprint } from "@launchstack/pipelines/vantage/weekly-review-validation";
import { canonicalTextHash } from "@launchstack/store/document-digests";
import type { TopicRetrievalContext } from "@launchstack/pipelines/vantage/topic-retrieval-v1";
import { normalizeTopicExcerpt, validTopicExcerptRange } from "./weekly-review-topic-exploration";
import { lexicalBackfillSpan } from "./weekly-review-topic-backfill";
import type { PreparedTopicSelection } from "./weekly-review-topic-run";
import {
    TOPIC_FIRST_LIMITS,
    topicManifestHash,
    type TopicOffer,
    type TopicSeed,
    type TopicEvidenceStrategy,
} from "./weekly-review-topic-types";
import {
    WeeklyReviewConflict,
    type FrozenDependency,
    type WeeklyReviewSource,
} from "./weekly-review-types";
import type {
    createScopedSourceReader,
    WeeklyReviewSourceScope,
} from "./weekly-review-scoped-selection";

type Span = { start: number; end: number };
export type TopicFreezeOptions = {
    evidenceCapBytes?: number;
    backfill?: boolean;
    seedWindows?: boolean;
    strategy?: TopicEvidenceStrategy;
    /** Benchmark-only snapshots from the same charged selection; no exploration rerun. */
    compareVariants?: boolean;
};
export type TopicFreeze = {
    /** Present only for a backfill fit, before any additional sources were admitted. */
    primary?: TopicFreeze;
    comparisons?: { live: TopicFreeze; liveBackfill: TopicFreeze };
    input: WeeklyReviewInput;
    dependencies: FrozenDependency[];
    summary: Pick<TopicRetrievalContext, "mode" | "lane" | "seedReasons" | "degradation"> & {
        outcome: "frozen" | "degraded";
    };
};
export function mergeTopicSpans(spans: Span[], text: string): Span[] {
    const merged: Span[] = [];
    for (const span of [...spans].sort((a, b) => a.start - b.start || a.end - b.end)) {
        if (!validTopicExcerptRange(text, span))
            throw new WeeklyReviewConflict("topic_exploration_failed:range_invalid");
        const previous = merged.at(-1);
        if (previous && span.start <= previous.end) previous.end = Math.max(previous.end, span.end);
        else merged.push({ ...span });
    }
    if (merged.length > 6 || merged.some(span => span.end - span.start > 6000))
        throw new WeeklyReviewConflict("topic_exploration_failed:range_invalid");
    return merged;
}

const defaultSpan = (text: string) => {
    const normalized = normalizeTopicExcerpt(text, { start: 0, end: Math.min(text.length, 6000) });
    return normalized ? [normalized] : [];
};
export async function fitTopicEvidence(
    runId: string,
    seed: TopicSeed,
    result: PreparedTopicSelection | null,
    read: ReturnType<typeof createScopedSourceReader>,
    options: TopicFreezeOptions = {}
): Promise<TopicFreeze> {
    const evidenceCapBytes = options.evidenceCapBytes ?? TOPIC_FIRST_LIMITS.evidenceBytes;
    if (![8000, 16000, 32000, 80000].includes(evidenceCapBytes))
        throw new WeeklyReviewConflict("topic_evidence_cap_invalid");
    const { manifest, context } = seed;
    const strategy = options.strategy ?? manifest.configuration.evidenceStrategy;
    if (strategy !== undefined && strategy !== "live-docs+windows")
        throw new WeeklyReviewConflict("topic_evidence_strategy_invalid");
    if (
        options.strategy &&
        manifest.configuration.evidenceStrategy &&
        options.strategy !== manifest.configuration.evidenceStrategy
    )
        throw new WeeklyReviewConflict("topic_evidence_strategy_mismatch");
    const boundedVariants = strategy === "live-docs+windows" || options.compareVariants === true;
    let authorizedReads = 0,
        acquiredParentBytes = 0;
    const authorizedScopes = new Map<string, Awaited<ReturnType<typeof read>>>();
    const degradation = result?.degradation;
    const seedWindows = result === null && options.seedWindows === true;
    const offered = new Map(seed.documents.map(document => [document.ref, document]));
    const selections = new Map<string, Span[]>();
    for (const item of result?.selected ??
        (seedWindows
            ? []
            : seed.documents.map(document => ({
                  ref: document.ref,
                  spans: defaultSpan(document.text),
              })))) {
        const document = offered.get(item.ref);
        if (!document) {
            if (manifest.fixed.some(fixed => fixed.ref === item.ref) && item.spans.length === 0)
                continue;
            throw new WeeklyReviewConflict("topic_exploration_failed:not_offered");
        }
        selections.set(item.ref, [...(selections.get(item.ref) ?? []), ...item.spans]);
    }
    for (const [ref, spans] of selections)
        selections.set(ref, mergeTopicSpans(spans, offered.get(ref)!.text));

    let sources: WeeklyReviewSource[] = [...context.sources];
    let proofs = [...(context.scopedEvidence ?? [])];
    const dependencies = [...manifest.fixedDependencies];
    const seedReasons: TopicRetrievalContext["seedReasons"] = [];
    const lane: TopicRetrievalContext["lane"] = {
        outcome: manifest.lane.length ? "capacity_shortfall" : "none_eligible",
        candidates: manifest.lane.length,
        admitted: 0,
    };
    const topics: TopicRetrievalContext["topics"] = [];
    // V2.1 projects the retrieval context into the Judge's bounded scenario title.
    // Keep complete notes in S1 and leave room here for the final unit refs and lane.
    for (const { id, title, openQuestions } of manifest.topics) {
        const next = { id, title, openQuestions: [] as string[] };
        if (JSON.stringify([...topics, next]).length > 3200) break;
        topics.push(next);
        for (const question of openQuestions) {
            next.openQuestions.push(question);
            if (JSON.stringify(topics).length > 3200) next.openQuestions.pop();
        }
    }
    const makeInput = (
        nextSources = sources,
        nextProofs = proofs,
        reasons = seedReasons,
        nextLane = lane
    ): WeeklyReviewInput => {
        const base = {
            candidateId: runId,
            week: manifest.week,
            asOf: manifest.asOf,
            role: context.role,
            mandatoryCoverage: context.mandatoryCoverage,
            sources: nextSources,
            ...(nextProofs.length ? { scopedEvidence: nextProofs } : {}),
        };
        const contextFields = {
            schemaVersion: "vantage-topic-retrieval/v1" as const,
            mode: "topic-first" as const,
            guidanceLabel: "owner notes, not evidence" as const,
            topics,
            seedReasons: reasons,
            lane: { ...nextLane },
            ...(degradation ? { degradation } : {}),
        };
        return {
            ...base,
            retrievalContext: {
                ...contextFields,
                traceHash: fingerprint([
                    topicManifestHash(manifest),
                    { ...base, retrievalContext: contextFields },
                ]),
            },
        };
    };
    const evidenceBytes = (values: readonly { text: string }[] = sources) =>
        values.reduce((total, source) => total + Buffer.byteLength(source.text, "utf8"), 0);
    const fits = (input: WeeklyReviewInput) =>
        evidenceBytes(input.sources) <= evidenceCapBytes &&
        calculateWeeklyReviewBudget(input, "topic-first").feasible;
    if (!fits(makeInput())) throw new WeeklyReviewConflict("mandatory_context_budget_exceeded");

    const addDocument = async (ref: string, spans: Span[], asLane: boolean) => {
        const document = offered.get(ref);
        if (!document || spans.length === 0 || sources.length + spans.length > 16) return false;
        // The pinned canonical text gives an exact cheap cap check before charging an authorized reread.
        const addedBytes = spans.reduce(
            (total, span) =>
                total + Buffer.byteLength(document.text.slice(span.start, span.end), "utf8"),
            0
        );
        if (evidenceBytes() + addedBytes > evidenceCapBytes) return false;
        const scope: WeeklyReviewSourceScope = {
            version: document.version,
            expectedParentHash: document.hash,
            qualification: "Selected excerpts from the exact indexed version.",
            requiredUnits: spans.map(({ start, end }) => ({
                id: "excerpt-" + start + "-" + end,
                start,
                end,
                excerptHash: canonicalTextHash(document.text.slice(start, end)),
            })),
        };
        const cacheKey = JSON.stringify([ref, scope]);
        let next = boundedVariants ? authorizedScopes.get(cacheKey) : undefined;
        if (!next) {
            const parentBytes = Buffer.byteLength(document.text, "utf8");
            if (
                boundedVariants &&
                (authorizedReads >= TOPIC_FIRST_LIMITS.offered ||
                    acquiredParentBytes + parentBytes > TOPIC_FIRST_LIMITS.loadedParentBytes)
            )
                return false;
            authorizedReads++;
            acquiredParentBytes += parentBytes;
            next = await read(
                document.id,
                document.purpose,
                manifest.cutoff,
                scope,
                "topic-first:" + topicManifestHash(manifest)
            );
            if (boundedVariants) authorizedScopes.set(cacheKey, next);
        }
        if (
            next.descriptor.audience !== document.audience ||
            next.descriptor.versionDate !== document.versionDate
        )
            throw new WeeklyReviewConflict("source_authority_changed", 403);
        const nextLane = asLane ? { ...lane, outcome: "admitted" as const, admitted: 1 } : lane;
        const reasons = next.sources.map(source => ({
            ref: source.ref,
            reason: asLane ? ("lane" as const) : document.reason,
        }));
        const nextSources = [...sources, ...next.sources],
            nextProofs = [...proofs, next.descriptor];
        if (!fits(makeInput(nextSources, nextProofs, [...seedReasons, ...reasons], nextLane)))
            return false;
        sources = nextSources;
        proofs = nextProofs;
        Object.assign(lane, nextLane);
        dependencies.push(next.dependency);
        seedReasons.push(...reasons);
        return true;
    };
    const addSelection = async (ref: string, spans: Span[], asLane: boolean) => {
        if (!degradation) return addDocument(ref, spans, asLane);
        // A fallback may retain fewer whole reads for a parent. It never expands them.
        const document = offered.get(ref);
        if (!document) return false;
        let remainingBytes = evidenceCapBytes - evidenceBytes();
        const availableUnits = 16 - sources.length;
        const kept: Span[] = [];
        for (const span of spans) {
            if (kept.length === availableUnits) break;
            const bytes = Buffer.byteLength(document.text.slice(span.start, span.end), "utf8");
            if (bytes > remainingBytes) continue;
            kept.push(span);
            remainingBytes -= bytes;
        }
        return addDocument(ref, kept, asLane);
    };
    const addLexicalWindow = async (ref: string, asLane: boolean) => {
        const document = offered.get(ref);
        if (!document || sources.length >= 16) return false;
        const span = lexicalBackfillSpan(
            document.text,
            manifest.topics,
            evidenceCapBytes - evidenceBytes()
        );
        return span !== null && addDocument(ref, mergeTopicSpans([span], document.text), asLane);
    };
    const admitted = new Set<string>();
    let laneRef: string | undefined;
    for (const ref of manifest.lane) {
        const document = offered.get(ref)!;
        // Prefer the model's exact spans when it also selected this change.
        const spans = selections.get(ref);
        if (
            seedWindows
                ? await addLexicalWindow(ref, true)
                : degradation
                  ? await addSelection(ref, spans ?? [], true)
                  : await addDocument(ref, spans?.length ? spans : defaultSpan(document.text), true)
        ) {
            laneRef = ref;
            admitted.add(ref);
            break;
        }
    }
    if (seedWindows) {
        for (const document of seed.documents) {
            if (sources.length >= 16) break;
            if (!admitted.has(document.ref) && (await addLexicalWindow(document.ref, false)))
                admitted.add(document.ref);
        }
    } else
        for (const [ref, spans] of selections) {
            if (ref !== laneRef && (await addSelection(ref, spans, false))) admitted.add(ref);
        }
    const snapshot = (): TopicFreeze => ({
        input: makeInput(
            [...sources],
            [...proofs],
            seedReasons.map(reason => ({ ...reason })),
            { ...lane }
        ),
        dependencies: [...dependencies],
        summary: {
            mode: "topic-first",
            lane: { ...lane },
            seedReasons: seedReasons.map(reason => ({ ...reason })),
            outcome: degradation ? "degraded" : "frozen",
            ...(degradation ? { degradation } : {}),
        },
    });
    const live = snapshot();
    const restore = (frozen: TopicFreeze) => {
        sources = [...frozen.input.sources] as WeeklyReviewSource[];
        proofs = [...(frozen.input.scopedEvidence ?? [])];
        dependencies.splice(0, dependencies.length, ...frozen.dependencies);
        seedReasons.splice(0, seedReasons.length, ...frozen.summary.seedReasons);
        Object.assign(lane, frozen.summary.lane);
        admitted.clear();
        for (const descriptor of proofs)
            admitted.add(`doc:${descriptor.documentId}@${descriptor.parentVersion}`);
    };
    const fillSeeds = async () => {
        for (const document of seed.documents) {
            if (sources.length >= 16) break;
            if (admitted.has(document.ref)) continue;
            if (await addLexicalWindow(document.ref, false)) admitted.add(document.ref);
        }
    };
    let hybrid: TopicFreeze | undefined;
    if (strategy === "live-docs+windows" && !degradation) {
        restore(live);
        // Bounded planning over pinned text only. At most one authorized upgrade per
        // chosen parent; no repeated full refits or reader calls while tuning a window.
        for (const [ref, original] of selections) {
            const document = offered.get(ref)!;
            const existingSources = sources.filter(
                source =>
                    source.id === document.id &&
                    source.version === document.version &&
                    source.purpose === document.purpose
            );
            // The lane may have admitted a default span even when the model's
            // selection has no spans. Every already-frozen range stays protected.
            const protectedRanges = mergeTopicSpans(
                [
                    ...original,
                    ...proofs
                        .filter(
                            proof =>
                                proof.documentId === document.id &&
                                proof.parentVersion === document.version &&
                                proof.purpose === document.purpose
                        )
                        .flatMap(proof => proof.units.map(({ start, end }) => ({ start, end }))),
                ],
                document.text
            );
            const priorBytes = evidenceBytes(existingSources);
            const availableBytes = evidenceCapBytes - evidenceBytes() + priorBytes;
            const availableUnits = 16 - sources.length + existingSources.length;
            let allowance = availableBytes;
            let candidate: Span[] | null = null;
            for (let attempt = 0; attempt < 6 && allowance >= 200; attempt++) {
                const window = lexicalBackfillSpan(document.text, manifest.topics, allowance);
                if (!window) break;
                try {
                    const merged = mergeTopicSpans([...protectedRanges, window], document.text);
                    const bytes = merged.reduce(
                        (sum, span) =>
                            sum +
                            Buffer.byteLength(document.text.slice(span.start, span.end), "utf8"),
                        0
                    );
                    if (
                        merged.length <= availableUnits &&
                        bytes <= availableBytes &&
                        JSON.stringify(merged) !== JSON.stringify(protectedRanges)
                    ) {
                        candidate = merged;
                        break;
                    }
                } catch (error) {
                    if (
                        !(error instanceof WeeklyReviewConflict) ||
                        error.message !== "topic_exploration_failed:range_invalid"
                    )
                        throw error;
                }
                allowance = Math.floor(allowance / 2);
            }
            if (!candidate) continue;
            const before = snapshot();
            const priorRefs = new Set(existingSources.map(source => source.ref));
            sources = sources.filter(source => !priorRefs.has(source.ref));
            proofs = proofs.filter(
                proof =>
                    !(
                        proof.documentId === document.id &&
                        proof.parentVersion === document.version &&
                        proof.purpose === document.purpose
                    )
            );
            for (let index = dependencies.length - 1; index >= 0; index--) {
                const dependency = dependencies[index]!;
                if (
                    dependency.kind === "scoped-document" &&
                    dependency.id === document.id &&
                    dependency.version === document.version &&
                    dependency.purpose === document.purpose
                )
                    dependencies.splice(index, 1);
            }
            for (let index = seedReasons.length - 1; index >= 0; index--)
                if (priorRefs.has(seedReasons[index]!.ref)) seedReasons.splice(index, 1);
            if (await addDocument(ref, candidate, ref === laneRef)) admitted.add(ref);
            else restore(before);
        }
        await fillSeeds();
        hybrid = snapshot();
    }
    // Comparison work follows the hybrid so it cannot consume that strategy's
    // acquisition allowance or alter its result. Identical scopes reuse one read.
    let liveBackfill: TopicFreeze | undefined;
    if (options.backfill || options.compareVariants) {
        restore(live);
        if (!degradation) await fillSeeds();
        liveBackfill = snapshot();
    }
    const frozen = hybrid ?? (options.backfill ? liveBackfill! : live);
    const primary = options.backfill ? live : undefined;
    const comparisons = options.compareVariants
        ? { live, liveBackfill: liveBackfill ?? live }
        : undefined;
    return { ...frozen, ...(primary ? { primary } : {}), ...(comparisons ? { comparisons } : {}) };
}

export function matchesOffer(offer: TopicOffer, dependency: FrozenDependency) {
    return (
        dependency.kind === "scoped-document" &&
        dependency.id === offer.id &&
        dependency.version === offer.version &&
        dependency.hash === offer.hash &&
        dependency.purpose === offer.purpose &&
        dependency.scope?.dependency.audience === offer.audience &&
        dependency.scope?.dependency.versionDate === offer.versionDate
    );
}
