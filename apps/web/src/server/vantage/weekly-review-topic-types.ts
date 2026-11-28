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
export type TopicEvidenceStrategy = "live+backfill";
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
    goals?: readonly string[];
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
export function topicFirstProvider(env = process.env): TopicProvider {
    const injected = env.VANTAGE_WEEKLY_REVIEW_TEST_PROVIDER === "true";
    if (injected) {
        if (
            env.NODE_ENV === "production" ||
            env.DATABASE_URL !==
                "postgres://postgres:vantage_port_disposable@127.0.0.1:55439/vantage_port"
        )
            throw new Error("test_provider_not_allowed");
        return "scripted";
    }
    return "configured";
}

/** The production evidence strategy is captured in the immutable manifest. */
export function topicFirstEvidenceStrategy(): TopicEvidenceStrategy {
    return "live+backfill";
}
