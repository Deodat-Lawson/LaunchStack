import {
    calculateWeeklyReviewBudget,
    type WeeklyReviewInput,
} from "@launchstack/pipelines/vantage/weekly-review-v21";
import { fingerprint } from "@launchstack/pipelines/vantage/weekly-review-validation";
import { canonicalTextHash } from "@launchstack/store/document-digests";
import type { TopicRetrievalContext } from "@launchstack/pipelines/vantage/topic-retrieval-v1";
import type { TopicExplorationResult } from "./weekly-review-topic-exploration";
import { topicManifestHash, type TopicOffer, type TopicSeed } from "./weekly-review-topic-types";
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
export type TopicFreeze = {
    input: WeeklyReviewInput;
    dependencies: FrozenDependency[];
    summary: Pick<TopicRetrievalContext, "mode" | "lane" | "seedReasons"> & { outcome: "frozen" };
};
export function mergeTopicSpans(spans: Span[], length: number): Span[] {
    const merged: Span[] = [];
    for (const span of [...spans].sort((a, b) => a.start - b.start || a.end - b.end)) {
        if (
            !Number.isSafeInteger(span.start) ||
            !Number.isSafeInteger(span.end) ||
            span.start < 0 ||
            span.end > length ||
            span.end - span.start < 200 ||
            span.end - span.start > 6000
        )
            throw new WeeklyReviewConflict("topic_exploration_failed:range_invalid");
        const previous = merged.at(-1);
        if (previous && span.start <= previous.end) previous.end = Math.max(previous.end, span.end);
        else merged.push({ ...span });
    }
    if (merged.length > 6 || merged.some(span => span.end - span.start > 6000))
        throw new WeeklyReviewConflict("topic_exploration_failed:range_invalid");
    return merged;
}

const defaultSpan = (text: string) =>
    text.length < 200 ? [] : [{ start: 0, end: Math.min(text.length, 6000) }];
export async function fitTopicEvidence(
    runId: string,
    seed: TopicSeed,
    result: TopicExplorationResult | null,
    read: ReturnType<typeof createScopedSourceReader>
): Promise<TopicFreeze> {
    const { manifest, context } = seed;
    const offered = new Map(seed.documents.map(document => [document.ref, document]));
    const selections = new Map<string, Span[]>();
    for (const item of result?.selected ??
        seed.documents.map(document => ({
            ref: document.ref,
            spans: defaultSpan(document.text),
        }))) {
        const document = offered.get(item.ref);
        if (!document) {
            if (manifest.fixed.some(fixed => fixed.ref === item.ref) && item.spans.length === 0)
                continue;
            throw new WeeklyReviewConflict("topic_exploration_failed:not_offered");
        }
        selections.set(item.ref, [...(selections.get(item.ref) ?? []), ...item.spans]);
    }
    for (const [ref, spans] of selections)
        selections.set(ref, mergeTopicSpans(spans, offered.get(ref)!.text.length));

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
    if (!calculateWeeklyReviewBudget(makeInput(), "topic-first").feasible)
        throw new WeeklyReviewConflict("mandatory_context_budget_exceeded");

    const addDocument = async (ref: string, spans: Span[], asLane: boolean) => {
        const document = offered.get(ref);
        if (!document || spans.length === 0 || sources.length + spans.length > 16) return false;
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
        if (
            !calculateWeeklyReviewBudget(
                makeInput(nextSources, nextProofs, [...seedReasons, ...reasons], nextLane),
                "topic-first"
            ).feasible
        )
            return false;
        sources = nextSources;
        proofs = nextProofs;
        Object.assign(lane, nextLane);
        dependencies.push(next.dependency);
        seedReasons.push(...reasons);
        return true;
    };
    let laneRef: string | undefined;
    for (const ref of manifest.lane) {
        const document = offered.get(ref)!;
        // Prefer the model's exact spans when it also selected this change.
        const spans = selections.get(ref);
        if (await addDocument(ref, spans?.length ? spans : defaultSpan(document.text), true)) {
            laneRef = ref;
            break;
        }
    }
    for (const [ref, spans] of selections) {
        if (ref !== laneRef) await addDocument(ref, spans, false);
    }
    const input = makeInput();
    return {
        input,
        dependencies,
        summary: { mode: "topic-first", lane, seedReasons, outcome: "frozen" },
    };
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
