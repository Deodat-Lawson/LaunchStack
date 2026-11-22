import { createLangchainAgentPort, isChatRoute, type AgentModelPort } from "@launchstack/llm";
import {
    deterministicDigestProvider,
    getDigestsForVersions,
    type DocumentDigest,
    type DigestProvider,
} from "@launchstack/store/document-digests";
import { scopeAllowsDocument } from "~/lib/authz/scope-types";
import type { WeeklyReviewAuthorityActor } from "./weekly-review-authority";
import {
    createScriptedExplorationPort,
    explorationDocumentHandle,
    runTopicExploration,
    topicExplorationFailureCode,
    type ExplorationDocument,
    type ExplorationTrace,
    type TopicExplorationResult,
} from "./weekly-review-topic-exploration";
import { TOPIC_FIRST_LIMITS, type TopicSeed } from "./weekly-review-topic-types";
import { WeeklyReviewConflict, type WeeklyReviewQuery } from "./weekly-review-types";

export type TopicSelectionProviders = {
    digest: DigestProvider;
    exploration: (documents: readonly ExplorationDocument[]) => AgentModelPort;
};

/** Resolve configured routes only when production or an explicitly approved runner needs them. */
export async function configuredTopicSelectionProviders(): Promise<TopicSelectionProviders> {
    const route = process.env.VANTAGE_TOPIC_FIRST_EXPLORATION_ROUTE ?? "reasoning";
    if (!isChatRoute(route))
        throw new WeeklyReviewConflict("topic_exploration_failed:model_unavailable");
    const [{ resolveConfiguredChatModel }, { resolveDocumentDigestProvider }] = await Promise.all([
        import("~/lib/models"),
        import("./document-digest-provider"),
    ]);
    return {
        digest: resolveDocumentDigestProvider(),
        exploration: () =>
            createLangchainAgentPort(
                resolveConfiguredChatModel({
                    route,
                    maxRetries: 0,
                    maxOutputTokens: 6000,
                    timeoutMs: TOPIC_FIRST_LIMITS.explorationMs,
                })
            ),
    };
}

export async function resolveTopicSelectionProviders(
    seed: TopicSeed,
    override?: TopicSelectionProviders
): Promise<TopicSelectionProviders> {
    if (override) return override;
    return seed.manifest.configuration.provider === "configured"
        ? configuredTopicSelectionProviders()
        : { digest: deterministicDigestProvider, exploration: createScriptedExplorationPort };
}
export type TopicDigestTiming = {
    digestStartedAt: string;
    digestCompletedAt: string;
    digestDurationMs: number;
};

/** Reusable workspace prewarm. Query calls must each use their own short transaction. */
export async function prewarmTopicDigests(options: {
    actor: WeeklyReviewAuthorityActor;
    versionIds: string[];
    query: WeeklyReviewQuery;
    provider: DigestProvider;
    authorizeDocument: (document: { id: number; category: string }) => Promise<boolean>;
    cachePolicy?: "shared" | "ephemeral";
    timeoutMs?: number;
}) {
    const { actor, query } = options;
    if (!actor.canRead || !actor.canMutate)
        throw new WeeklyReviewConflict("review_mutation_denied", 403);
    const started = Date.now();
    const timeoutMs = Math.max(
        1,
        Math.min(900000, options.timeoutMs ?? TOPIC_FIRST_LIMITS.digestMs)
    );
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            reject(new WeeklyReviewConflict("topic_digest_failed:timeout"));
        }, timeoutMs);
    });
    try {
        const digests = await Promise.race([
            timeout,
            (async () => {
                const collected = new Map<string, DocumentDigest>();
                const versions = [...new Set(options.versionIds)];
                for (let index = 0; index < versions.length; index += 6) {
                    const results = await Promise.all(
                        versions.slice(index, index + 6).map(version =>
                            getDigestsForVersions({
                                companyId: actor.companyId,
                                versionIds: [version],
                                query,
                                provider: options.provider,
                                cachePolicy: options.cachePolicy,
                                signal: controller.signal,
                                documentScope: candidate =>
                                    scopeAllowsDocument(actor.documentScope, candidate),
                                authorizeDocument: options.authorizeDocument,
                            })
                        )
                    );
                    controller.signal.throwIfAborted();
                    for (const result of results)
                        for (const [version, digest] of result) collected.set(version, digest);
                }
                return collected;
            })(),
        ]);
        return {
            digests,
            digestIds: [...digests.values()].map(digest => digest.id),
            timing: {
                digestStartedAt: new Date(started).toISOString(),
                digestCompletedAt: new Date().toISOString(),
                digestDurationMs: Date.now() - started,
            } satisfies TopicDigestTiming,
        };
    } catch (error) {
        controller.abort();
        if (error instanceof WeeklyReviewConflict) throw error;
        throw new WeeklyReviewConflict(
            "topic_digest_failed:" + (Date.now() - started >= timeoutMs ? "timeout" : "provider")
        );
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export async function prepareTopicSelection(options: {
    seed: TopicSeed;
    actor: WeeklyReviewAuthorityActor;
    query: WeeklyReviewQuery;
    deadlineAt: number;
    digests: ReadonlyMap<string, DocumentDigest>;
    evidenceCapBytes?: number;
    providers?: TopicSelectionProviders;
    onStage?: (stage: "exploration") => void;
    record: (values: { trace?: ExplorationTrace; digestIds?: string[] }) => Promise<void>;
}): Promise<TopicExplorationResult | null> {
    const { seed, actor, deadlineAt, record } = options;
    const evidenceCapBytes = options.evidenceCapBytes ?? 80000;
    if (![8000, 16000, 32000, 80000].includes(evidenceCapBytes))
        throw new WeeklyReviewConflict("topic_exploration_failed:evidence_budget_invalid");
    if (seed.manifest.configuration.provider === "seeds") return null;
    const controller = new AbortController();
    const expired = () => new WeeklyReviewConflict("topic_exploration_failed:timeout");
    if (Date.now() >= deadlineAt) throw expired();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(
            () => {
                controller.abort();
                reject(expired());
            },
            Math.max(0, deadlineAt - Date.now())
        );
    });
    try {
        return await Promise.race([
            deadline,
            (async () => {
                if (
                    !actor.canRead ||
                    !actor.canMutate ||
                    actor.companyId !== seed.context.actor.companyId ||
                    actor.userId !== seed.context.actor.userId
                )
                    throw new WeeklyReviewConflict("review_mutation_denied", 403);
                const providers = await resolveTopicSelectionProviders(seed, options.providers);
                const digests = options.digests;
                controller.signal.throwIfAborted();
                const documents = seed.documents.map(document => {
                    const digest = digests.get(document.version);
                    return {
                        ...document,
                        digest: digest?.contentHash === document.hash ? digest : undefined,
                    };
                });
                const catalogue = {
                    topics: seed.manifest.topics.map(topic => ({
                        id: topic.id,
                        title: topic.title,
                        openQuestionCount: topic.openQuestions.length,
                        watchCount: topic.watches.length,
                    })),
                    fixed: seed.context.sources
                        .filter(source => source.audience === "company")
                        .map(({ ref, title }) => ({ ref, title })),
                    offered: documents.map(
                        ({ ref, title, category, versionDate, reason, digest }) => ({
                            handle: explorationDocumentHandle({ ref }),
                            ref,
                            title: title.slice(0, 180),
                            category: category.slice(0, 100),
                            versionDate,
                            reason,
                            digestHeadline: digest?.headline ?? "unavailable",
                        })
                    ),
                    lane: seed.manifest.lane,
                };
                if (
                    Buffer.byteLength(JSON.stringify(catalogue)) > TOPIC_FIRST_LIMITS.catalogueBytes
                )
                    throw new WeeklyReviewConflict("topic_exploration_failed:catalogue_limit");
                await record({
                    digestIds: documents.flatMap(document =>
                        document.digest ? [document.digest.id] : []
                    ),
                });
                options.onStage?.("exploration");
                const port = providers.exploration(documents);
                const result = await runTopicExploration({
                    catalogue,
                    offered: documents,
                    fixedRefs: catalogue.fixed.map(source => source.ref),
                    fixedDocuments: catalogue.fixed,
                    evidenceBudget: {
                        maxEvidenceBytes: evidenceCapBytes,
                        maxSourceUnits: 16,
                        fixedSources: seed.context.sources.map(({ ref, text }) => ({ ref, text })),
                    },
                    topics: seed.manifest.topics.map(topic => ({
                        ...topic,
                        watches: topic.watches.flatMap(id => [
                            ...documents
                                .filter(document => document.id === id)
                                .map(document => document.ref),
                            ...seed.manifest.fixed
                                .filter(
                                    document =>
                                        document.id === id && document.audience === "company"
                                )
                                .map(document => document.ref),
                        ]),
                    })),
                    port,
                    record: trace => record({ trace }),
                    deadlineAt,
                    signal: controller.signal,
                });
                return { selected: result.selected };
            })(),
        ]);
    } catch (error) {
        if (error instanceof WeeklyReviewConflict) throw error;
        if (controller.signal.aborted || Date.now() >= deadlineAt) throw expired();
        throw new WeeklyReviewConflict(topicExplorationFailureCode(error));
    } finally {
        if (timer) clearTimeout(timer);
    }
}
