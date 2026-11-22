import { fingerprint } from "@launchstack/pipelines/vantage/weekly-review-validation";
import type { PersonalTopic } from "./weekly-review-personal-topics";
import type {
    FrozenDependency,
    WeeklyReviewContext,
    WeeklyReviewSource,
} from "./weekly-review-types";

export const TOPIC_FIRST_LIMITS = Object.freeze({
    offered: 50,
    catalogueBytes: 48000,
    parentBytes: 40000,
    loadedParentBytes: 2000000,
    evidenceBytes: 80000,
    digestMs: 180000,
    explorationMs: 150000,
    generationMs: 90000,
    judgeMs: 120000,
    expirySeconds: 210,
});
export type TopicEvidenceStrategy = "live-docs+windows";
export type TopicProvider = "seeds" | "scripted" | "configured";
export type TopicSeedReason = "watch" | "carryover" | "question" | "change" | "lane" | "recency";
export type TopicOffer = {
    ref: string;
    id: string;
    version: string;
    versionDate: string;
    hash: string;
    audience: "company";
    purpose: "retrieved";
    reason: TopicSeedReason;
};
export type TopicFixed = Pick<
    WeeklyReviewSource,
    "ref" | "id" | "version" | "hash" | "purpose" | "audience"
>;
export type TopicManifest = {
    week: string;
    cutoff: string;
    asOf: string;
    epoch: string;
    expectedActiveId: string | null;
    configuration: {
        provider: TopicProvider;
        scoped: boolean;
        evidenceStrategy?: TopicEvidenceStrategy;
    };
    revisions: { policy: number; preference: number; role: number | null };
    topics: PersonalTopic[];
    fixed: TopicFixed[];
    fixedDependencies: FrozenDependency[];
    offered: TopicOffer[];
    lane: string[];
    carryover: { priorRunId: string; reviewVersion: number; seedIds: string[] } | "unavailable";
};
export type TopicSeed = {
    manifest: TopicManifest;
    context: WeeklyReviewContext;
    documents: (TopicOffer & { text: string; title: string; category: string })[];
};
export const topicManifestHash = (manifest: TopicManifest) => fingerprint(manifest);
export function topicInputHash(manifest: TopicManifest) {
    return fingerprint({
        week: manifest.week,
        expectedActiveId: manifest.expectedActiveId,
        cutoff: manifest.cutoff,
        epoch: manifest.epoch,
        manifestHash: topicManifestHash(manifest),
        configuration: manifest.configuration,
    });
}
export function topicFirstProvider(env = process.env): TopicProvider | null {
    if (env.VANTAGE_TOPIC_FIRST_ENABLED !== "true") return null;
    const injected = env.VANTAGE_WEEKLY_REVIEW_TEST_PROVIDER === "true";
    const provider = env.VANTAGE_TOPIC_FIRST_PROVIDER ?? (injected ? "scripted" : "configured");
    if (injected && (provider === "scripted" || provider === "seeds")) return provider;
    if (!injected && provider === "configured") return provider;
    throw new Error("topic_first_provider_invalid");
}

/** Optional frozen-evidence policy, captured with the run manifest before reservation. */
export function topicFirstEvidenceStrategy(
    env: Record<string, string | undefined> = process.env
): TopicEvidenceStrategy | undefined {
    const value = env.VANTAGE_TOPIC_FIRST_EVIDENCE_STRATEGY;
    if (value === undefined || value === "") return undefined;
    if (value === "live-docs+windows") return value;
    throw new Error("topic_first_evidence_strategy_invalid");
}
