import {
    calculateWeeklyReviewBudget,
    type WeeklyReviewInput,
} from "@launchstack/pipelines/vantage/weekly-review-v21";
import { fingerprint } from "@launchstack/pipelines/vantage/weekly-review-validation";
import { canonicalTextHash } from "@launchstack/store/document-digests";
import type { TopicRetrievalContext } from "@launchstack/pipelines/vantage/topic-retrieval-v1";
import {
    normalizeTopicExcerpt,
    validTopicExcerptRange,
    type TopicExplorationResult,
} from "./weekly-review-topic-exploration";
import { lexicalBackfillSpan } from "./weekly-review-topic-backfill";
import {
    TOPIC_FIRST_LIMITS,
    topicManifestHash,
    type TopicOffer,
    type TopicSeed,
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
};
export type TopicFreeze = {
    /** Present only for a backfill fit, before any additional sources were admitted. */
    primary?: TopicFreeze;
    input: WeeklyReviewInput;
    dependencies: FrozenDependency[];
    summary: Pick<TopicRetrievalContext, "mode" | "lane" | "seedReasons"> & { outcome: "frozen" };
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
    result: TopicExplorationResult | null,
    read: ReturnType<typeof createScopedSourceReader>,
    options: TopicFreezeOptions = {}
): Promise<TopicFreeze> {
    const evidenceCapBytes = options.evidenceCapBytes ?? TOPIC_FIRST_LIMITS.evidenceBytes;
    if (![8000, 16000, 32000, 80000].includes(evidenceCapBytes))
        throw new WeeklyReviewConflict("topic_evidence_cap_invalid");
    const { manifest, context } = seed;
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
        const next = await read(
            document.id,
            document.purpose,
            manifest.cutoff,
            scope,
            "topic-first:" + topicManifestHash(manifest)
        );
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
            if (ref !== laneRef && (await addDocument(ref, spans, false))) admitted.add(ref);
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
            outcome: "frozen",
        },
    });
    const primary = options.backfill ? snapshot() : undefined;
    if (options.backfill) {
        for (const document of seed.documents) {
            if (sources.length >= 16) break;
            if (admitted.has(document.ref)) continue;
            if (await addLexicalWindow(document.ref, false)) admitted.add(document.ref);
        }
    }
    const frozen = snapshot();
    return primary ? { ...frozen, primary } : frozen;
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
