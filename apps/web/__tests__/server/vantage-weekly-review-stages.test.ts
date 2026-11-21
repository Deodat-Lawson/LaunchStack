import {
    assertWeeklyReviewWeek,
    generateWeeklyReview,
} from "~/server/vantage/weekly-review-service";
import { createWeeklyReviewAuthority } from "~/server/vantage/weekly-review-authority";
import { createWeeklyReviewRepository } from "~/server/vantage/weekly-review-repository";
import { runWeeklyReviewV21 } from "@launchstack/pipelines/vantage/weekly-review-v21";
jest.mock("@launchstack/llm", () => ({ isChatRoute: () => true }));
jest.mock("~/server/engine", () => ({ getEngine: jest.fn() }));
jest.mock("~/lib/require-workspace-context", () => ({ requireWorkspaceContext: jest.fn() }));
jest.mock("~/lib/models", () => ({ resolveConfiguredChatModel: jest.fn() }));
jest.mock("~/server/workspace-models/scope", () => ({
    withWorkspaceChatModels: (_id: unknown, _scope: unknown, work: () => unknown) => work(),
}));
jest.mock("~/server/vantage/weekly-review-authority", () => ({
    createWeeklyReviewAuthority: jest.fn(),
}));
jest.mock("~/server/vantage/weekly-review-repository", () => ({
    createWeeklyReviewRepository: jest.fn(),
}));
jest.mock("~/server/vantage/weekly-review-test-provider", () => ({
    weeklyReviewTestPorts: () => ({}),
}));
jest.mock("~/server/vantage/weekly-review-dynamic-retrieval", () => ({
    dynamicRetrievalConfiguration: () => ({ mode: "baseline" }),
}));
jest.mock("@launchstack/pipelines/vantage/weekly-review-v21", () => ({
    runWeeklyReviewV21: jest.fn(),
    reviewFingerprint: () => "hash",
}));
jest.mock("@launchstack/pipelines/vantage", () =>
    jest.requireActual("../../../../pipelines/src/vantage/week")
);
it.each(["2026-11-17", "2026-11-15", "2026-02-30", "bad", "2026-11-16 "])(
    "rejects invalid/non-Monday date %s",
    week => {
        expect(() => assertWeeklyReviewWeek(week)).toThrow("invalid_review_week");
    }
);
it("accepts exact Monday", () => {
    expect(() => assertWeeklyReviewWeek("2026-11-16")).not.toThrow();
});
it.each([false, true])(
    "stages originate at real operations and observer failure=%s cannot corrupt commit",
    async throws => {
        process.env.VANTAGE_WEEKLY_REVIEW_ENABLED = "true";
        process.env.VANTAGE_INTERNAL_RETRIEVAL_V1_ENABLED = "false";
        const order: string[] = [];
        jest.mocked(createWeeklyReviewAuthority).mockReturnValue({
            collectWeeklyReviewContext: async () => {
                order.push("collect");
                return {
                    authorityEpoch: "epoch",
                    role: "founder",
                    sources: [],
                    mandatoryCoverage: { required: 1, included: 1 },
                };
            },
        } as never);
        const repository = {
            findByKey: jest.fn(async () => null),
            reserve: jest.fn(async () => ({ created: true, id: "run" })),
            authorizeDispatch: jest.fn(async (_a: unknown, _b: unknown, kind: string) => {
                order.push("authorize:" + kind);
            }),
            accept: jest.fn(async () => {
                order.push("accept");
            }),
            get: jest.fn(async () => ({ id: "run" })),
            fail: jest.fn(),
        };
        jest.mocked(createWeeklyReviewRepository).mockReturnValue(repository as never);
        jest.mocked(runWeeklyReviewV21).mockImplementation(async (_input, ports) => {
            await ports.authorizeDispatch("generation");
            order.push("generated");
            ports.onGenerationComplete?.();
            order.push("validate");
            await ports.authorizeDispatch("judge");
            return { report: { topics: [] }, evidence: {} } as never;
        });
        const result = await generateWeeklyReview(
            { companyId: "1", userId: "user" },
            { weekStart: "2026-11-16", key: "stable_key", expectedActiveId: null },
            stage => {
                order.push(stage);
                if (throws) throw Error("disconnected");
            }
        );
        expect(result).toEqual({ id: "run" });
        expect(order).toEqual([
            "gathering",
            "collect",
            "authorize:generation",
            "writing",
            "generated",
            "checking",
            "validate",
            "authorize:judge",
            "saving",
            "accept",
        ]);
        expect(repository.accept).toHaveBeenCalledTimes(1);
        expect(repository.fail).not.toHaveBeenCalled();
    }
);
