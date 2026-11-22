import { runWeeklyReviewV21 } from "@launchstack/pipelines/vantage/weekly-review-v21";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { createWeeklyReviewAuthority } from "~/server/vantage/weekly-review-authority";
import { createWeeklyReviewRepository } from "~/server/vantage/weekly-review-repository";
import { generateWeeklyReview } from "~/server/vantage/weekly-review-service";
import {
    prepareTopicSelection,
    prewarmTopicDigests,
    resolveTopicSelectionProviders,
} from "~/server/vantage/weekly-review-topic-run";
import { WeeklyReviewConflict } from "~/server/vantage/weekly-review-types";

jest.mock("~/server/engine", () => ({ getEngine: jest.fn() }));
jest.mock("~/lib/require-workspace-context", () => ({ requireWorkspaceContext: jest.fn() }));
jest.mock("~/lib/models", () => ({ resolveConfiguredChatModel: jest.fn() }));
jest.mock("~/server/workspace-models/scope", () => ({
    withWorkspaceChatModels: (_company: unknown, _scope: unknown, work: () => unknown) => work(),
}));
jest.mock("~/server/vantage/weekly-review-authority", () => ({
    createWeeklyReviewAuthority: jest.fn(),
}));
jest.mock("~/server/vantage/weekly-review-repository", () => ({
    createWeeklyReviewRepository: jest.fn(),
}));
jest.mock("~/server/vantage/weekly-review-topic-run", () => ({
    prepareTopicSelection: jest.fn(),
    prewarmTopicDigests: jest.fn(),
    resolveTopicSelectionProviders: jest.fn(),
}));
jest.mock("~/server/vantage/weekly-review-test-provider", () => ({
    weeklyReviewTestPorts: () => ({}),
}));
jest.mock("@launchstack/pipelines/vantage", () =>
    jest.requireActual("../../../../pipelines/src/vantage/week")
);
jest.mock("@launchstack/pipelines/vantage/weekly-review-v21", () => ({
    runWeeklyReviewV21: jest.fn(),
    reviewFingerprint: () => "test-input-hash",
}));

it.each(["digest", "exploring", "writing", "checking", "seeds"])(
    "preserves the active report on a %s timeout",
    async segment => {
        jest.clearAllMocks();
        const env = jest.replaceProperty(process, "env", {
            ...process.env,
            VANTAGE_WEEKLY_REVIEW_ENABLED: "true",
            VANTAGE_INTERNAL_RETRIEVAL_V1_ENABLED: "true",
            VANTAGE_TOPIC_FIRST_ENABLED: "true",
            VANTAGE_TOPIC_FIRST_PROVIDER: segment === "seeds" ? "seeds" : "scripted",
            VANTAGE_WEEKLY_REVIEW_TEST_PROVIDER: "true",
        });
        try {
            const actor = { companyId: "1", userId: "owner" };
            const input = {
                candidateId: "candidate",
                week: "2026-11-09",
                asOf: "2026-11-16T00:00:00.000Z",
                role: "owner",
                sources: [],
                mandatoryCoverage: { required: 1, included: 1 },
            };
            const context = {
                ...input,
                authorityEpoch: "2",
                topicSeed: {
                    documents: [],
                    manifest: {
                        configuration: { provider: segment === "seeds" ? "seeds" : "scripted" },
                    },
                },
            };
            jest.mocked(requireWorkspaceContext).mockResolvedValue({
                success: true,
                data: {
                    companyId: 1n,
                    authUserId: actor.userId,
                    role: "owner",
                    can: () => true,
                    documentScope: async () => ({ kind: "everything" }),
                },
            } as never);
            jest.mocked(createWeeklyReviewAuthority).mockReturnValue({
                collectWeeklyReviewContext: async () => context,
            } as never);
            const state = { active: "previous" };
            const repository = {
                findByKey: jest.fn(async () => null),
                reserveTopic: jest.fn(async () => ({ created: true, id: "candidate" })),
                beginDigestPreparation: jest.fn(),
                recordDigestPreparation: jest.fn(),
                recordExploration: jest.fn(),
                claimExploration: jest.fn(async () => Date.now() + 1000),
                freezeTopic: jest.fn(async () => ({ input })),
                authorizeDispatch: jest.fn(),
                accept: jest.fn(async () => {
                    state.active = "candidate";
                }),
                fail: jest.fn(),
            };
            jest.mocked(createWeeklyReviewRepository).mockReturnValue(repository as never);
            jest.mocked(resolveTopicSelectionProviders).mockResolvedValue({
                digest: jest.fn(),
                exploration: jest.fn(),
            });
            jest.mocked(prewarmTopicDigests).mockImplementation(async () => {
                if (segment === "digest")
                    throw new WeeklyReviewConflict("topic_digest_failed:timeout");
                return {
                    digests: new Map(),
                    digestIds: [],
                    timing: {
                        digestStartedAt: new Date().toISOString(),
                        digestCompletedAt: new Date().toISOString(),
                        digestDurationMs: 1,
                    },
                };
            });
            jest.mocked(prepareTopicSelection).mockImplementation(async () => {
                if (segment === "exploring")
                    throw new WeeklyReviewConflict("topic_exploration_failed:timeout");
                return null;
            });
            jest.mocked(runWeeklyReviewV21).mockImplementation(async (_input, ports) => {
                await ports.authorizeDispatch("generation");
                if (segment === "writing") throw Error("provider_timeout");
                ports.onGenerationComplete?.();
                await ports.authorizeDispatch("judge");
                throw Error("judge_admission_failed");
            });
            const stages: string[] = [];
            await expect(
                generateWeeklyReview(
                    actor,
                    {
                        weekStart: input.week,
                        key: "candidate-operation",
                        expectedActiveId: state.active,
                    },
                    stage => stages.push(stage)
                )
            ).rejects.toThrow(
                segment === "digest"
                    ? "topic_digest_failed:timeout"
                    : segment === "exploring"
                      ? "topic_exploration_failed:timeout"
                      : "candidate_not_admitted"
            );
            expect(stages.at(-1)).toBe(
                segment === "digest" ? "gathering" : segment === "seeds" ? "checking" : segment
            );
            if (segment === "digest") expect(repository.claimExploration).not.toHaveBeenCalled();
            else if (segment === "seeds") {
                expect(prewarmTopicDigests).not.toHaveBeenCalled();
                expect(resolveTopicSelectionProviders).not.toHaveBeenCalled();
                expect(repository.beginDigestPreparation).not.toHaveBeenCalled();
            } else {
                expect(prewarmTopicDigests).toHaveBeenCalledTimes(1);
                expect(jest.mocked(prewarmTopicDigests).mock.invocationCallOrder[0]).toBeLessThan(
                    repository.claimExploration.mock.invocationCallOrder[0]!
                );
            }
            expect(repository.fail).toHaveBeenCalledTimes(1);
            expect(repository.accept).not.toHaveBeenCalled();
            expect(state.active).toBe("previous");
        } finally {
            env.restore();
        }
    }
);
