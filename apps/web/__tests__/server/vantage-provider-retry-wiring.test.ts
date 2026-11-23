import {
    runWeeklyReviewV21,
    WeeklyReviewDiagnosticError,
} from "@launchstack/pipelines/vantage/weekly-review-v21";
import { createWeeklyReviewAuthority } from "~/server/vantage/weekly-review-authority";
import { createWeeklyReviewRepository } from "~/server/vantage/weekly-review-repository";
import { generateWeeklyReview, weeklyReviewDatabase } from "~/server/vantage/weekly-review-service";
import {
    prewarmTopicDigests,
    prepareTopicSelection,
    resolveTopicSelectionProviders,
    type TopicSelectionRetry,
} from "~/server/vantage/weekly-review-topic-run";
import { resolveConfiguredChatModel } from "~/lib/models";
import { getEngine } from "~/server/engine";
import { resolveDocumentDigestProvider } from "~/server/vantage/document-digest-provider";
import { WeeklyReviewConflict } from "~/server/vantage/weekly-review-types";
import type { ChatProviderRetryPolicy, ResolveChatModelOptions } from "@launchstack/llm";

jest.mock("~/server/engine", () => ({ getEngine: jest.fn() }));
jest.mock("~/server/beta-apps", () => ({
    requireBetaAppContext: async () => ({
        success: true,
        data: {
            companyId: 1n,
            authUserId: "owner",
            role: "owner",
            can: () => true,
            documentScope: async () => ({ kind: "everything" }),
        },
    }),
}));
jest.mock("~/lib/models", () => ({ resolveConfiguredChatModel: jest.fn() }));
jest.mock("~/server/workspace-models/scope", () => ({
    withWorkspaceChatModels: async (_company: unknown, _scope: unknown, work: () => unknown) =>
        work(),
}));
jest.mock("~/server/vantage/weekly-review-authority", () => ({
    createWeeklyReviewAuthority: jest.fn(),
}));
jest.mock("~/server/vantage/weekly-review-repository", () => ({
    createWeeklyReviewRepository: jest.fn(),
}));
jest.mock("~/server/vantage/weekly-review-topic-run", () => ({
    ...jest.requireActual("~/server/vantage/weekly-review-topic-run"),
    prewarmTopicDigests: jest.fn(),
    prepareTopicSelection: jest.fn(),
    resolveTopicSelectionProviders: jest.fn(),
}));
jest.mock("~/server/vantage/weekly-review-test-provider", () => ({
    weeklyReviewTestPorts: () => null,
}));
jest.mock("@launchstack/pipelines/vantage", () =>
    jest.requireActual("../../../../pipelines/src/vantage/week")
);
jest.mock("@launchstack/pipelines/vantage/weekly-review-v21", () => ({
    ...jest.requireActual("../../../../pipelines/src/vantage/weekly-review-diagnostics"),
    runWeeklyReviewV21: jest.fn(),
}));

function fixture(
    mode:
        | "success"
        | "revoke"
        | "creation"
        | "late_creation"
        | "raw"
        | "typed"
        | "deadline" = "success"
) {
    jest.mocked(getEngine).mockReturnValue({
        dbHandle: { client: { options: { max: 10 } } },
    } as never);
    const env = jest.replaceProperty(process, "env", {
        ...process.env,
        VANTAGE_WEEKLY_REVIEW_ENABLED: "true",
        VANTAGE_TOPIC_FIRST_PROVIDER: "configured",
    });
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
    const transaction = jest
        .spyOn(weeklyReviewDatabase, "transaction")
        .mockImplementation(work => work(async () => []));
    const actor = { companyId: "1", userId: "owner" };
    const input = {
        candidateId: "run",
        week: "2026-11-09",
        asOf: "2026-11-16T00:00:00.000Z",
        role: "owner",
        sources: [
            {
                ref: "doc:1@1",
                text: "PRIVATE_SOURCE",
                title: "private",
                purpose: "company-architecture",
            },
        ],
        mandatoryCoverage: { required: 1, included: 1 },
    };
    const manifest = {
        configuration: { provider: "configured" },
        fixedDependencies: [],
        epoch: "2",
    };
    const authority = {
        collectWeeklyReviewContext: jest.fn(async () => ({
            ...input,
            authorityEpoch: "2",
            topicSeed: { documents: [], manifest },
        })),
        assertTopicStep: jest.fn(async () => {}),
    };
    jest.mocked(createWeeklyReviewAuthority).mockReturnValue(authority as never);
    const repository = {
        findByKey: jest.fn(async () => null),
        reserveTopic: jest.fn(async () => ({ created: true, id: "run" })),
        beginDigestPreparation: jest.fn(),
        recordDigestPreparation: jest.fn(),
        recordExploration: jest.fn(),
        claimExploration: jest.fn(async () => Date.now() + 150000),
        freezeTopic: jest.fn(async () => ({ input })),
        authorizeDispatch: jest.fn(),
        beginProviderAttempt: jest.fn(
            async (_actor: unknown, _id: unknown, info: { stage: string; attempt: number }) => {
                if (mode === "revoke" && info.stage === "generation" && info.attempt === 2)
                    throw new WeeklyReviewConflict("source_authority_changed");
                if (mode === "late_creation" && info.stage === "generation")
                    process.env.VANTAGE_WEEKLY_REVIEW_ENABLED = "false";
                return info.stage + "-" + info.attempt;
            }
        ),
        completeProviderAttempt: jest.fn(),
        accept: jest.fn(),
        get: jest.fn(async () => ({ id: "run" })),
        fail: jest.fn(),
    };
    jest.mocked(createWeeklyReviewRepository).mockReturnValue(repository as never);
    let topicRetry: TopicSelectionRetry;
    const deadlines: Record<string, number[]> = {};
    const simulate = async (stage: string, policy: ChatProviderRetryPolicy) => {
        for (const attempt of [1, 2]) {
            const settle = await policy.beforeAttempt({ attempt, messageBytes: 123 });
            (deadlines[stage] ??= []).push(policy.deadlineAt);
            await settle({
                statusClass: attempt === 1 ? "unavailable" : "success",
                httpStatus: attempt === 1 ? 503 : 200,
            });
            if (mode === "creation" && stage === "generation" && attempt === 1)
                process.env.VANTAGE_WEEKLY_REVIEW_ENABLED = "false";
        }
    };
    jest.mocked(resolveTopicSelectionProviders).mockImplementation(
        async (_seed, _override, retry) => {
            topicRetry = retry!;
            return { digest: jest.fn(), exploration: jest.fn() } as never;
        }
    );
    jest.mocked(prewarmTopicDigests).mockImplementation(async () => {
        await simulate("digest", topicRetry.digest());
        return {
            digests: new Map(),
            digestIds: [],
            timing: {
                digestStartedAt: new Date().toISOString(),
                digestCompletedAt: new Date().toISOString(),
                digestDurationMs: 0,
            },
        };
    });
    jest.mocked(prepareTopicSelection).mockImplementation(async options => {
        await simulate("exploration", topicRetry.exploration(options.deadlineAt - 5000));
        return null;
    });
    const models: ResolveChatModelOptions[] = [];
    jest.mocked(resolveConfiguredChatModel).mockImplementation(options => {
        models.push(options!);
        return {
            modelId: "fake",
            behavior: { parameters: { maxOutputTokens: "supported" } },
        } as never;
    });
    jest.mocked(runWeeklyReviewV21).mockImplementation(async (_input, ports) => {
        await ports.authorizeDispatch("generation");
        await simulate("generation", models[0]!.providerRetry!);
        if (mode === "raw")
            throw Object.assign(Error("PRIVATE_PROVIDER_RESPONSE"), {
                code: "PRIVATE_ERROR_CODE",
                cause: { message: "PRIVATE_SOURCE" },
            });
        if (mode === "typed")
            throw new WeeklyReviewDiagnosticError("PRIVATE_VALIDATOR_TEXT", {
                stage: "generation_validation",
                ruleCodes: ["invalid_source_citation"],
                counts: {
                    sourceUnits: 1,
                    evidenceBytes: 14,
                    messageBytes: null,
                    citationsChecked: 3,
                    citationsFailed: 1,
                },
            });
        ports.onGenerationComplete?.();
        await ports.authorizeDispatch("judge");
        await simulate("judge", models[1]!.providerRetry!);
        if (mode === "deadline") await new Promise(() => {});
        return { report: { topics: [] }, evidence: {} } as never;
    });
    return {
        actor,
        authority,
        repository,
        errorLog,
        deadlines,
        models,
        run: () =>
            generateWeeklyReview(actor, {
                weekStart: "2026-11-09",
                key: "key",
                expectedActiveId: null,
            }),
        restore: () => {
            env.restore();
            errorLog.mockRestore();
            transaction.mockRestore();
        },
    };
}
beforeEach(() => jest.clearAllMocks());

it("keeps each digest segment inside 60 seconds and passes the same narrowed policy to the model", async () => {
    const started = Date.now();
    const policy: ChatProviderRetryPolicy = {
        deadlineAt: started + 180000,
        beforeAttempt: jest.fn(),
    };
    const resolve = jest.fn(() => ({
        chat: {
            invoke: jest.fn(async () => ({
                content: JSON.stringify({ headline: "safe", items: [] }),
            })),
        },
        prepareMessages: (messages: unknown) => messages,
    }));
    const provider = resolveDocumentDigestProvider(resolve as never, {
        providerRetry: () => policy,
    });
    await provider({ title: "PRIVATE_TITLE", text: "PRIVATE_SOURCE" });
    const options = resolve.mock.calls[0] as unknown as [ResolveChatModelOptions];
    expect(options[0]).toMatchObject({ maxRetries: 0, timeoutMs: 60000 });
    expect(options[0].providerRetry).toBe(policy);
    expect(policy.deadlineAt).toBeLessThanOrEqual(started + 60100);
});

it("wires all four stages with journaled physical attempts and unchanged retry deadlines", async () => {
    const f = fixture();
    const started = Date.now();
    try {
        await expect(f.run()).resolves.toEqual({ id: "run" });
        expect(f.repository.beginProviderAttempt).toHaveBeenCalledTimes(8);
        expect(f.repository.completeProviderAttempt).toHaveBeenCalledTimes(8);
        expect(f.authority.assertTopicStep).toHaveBeenCalledTimes(4);
        for (const values of Object.values(f.deadlines)) expect(values[0]).toBe(values[1]);
        expect(f.deadlines.digest![0]).toBeLessThanOrEqual(started + 180100);
        expect(f.deadlines.exploration![0]).toBeLessThanOrEqual(started + 145100);
        expect(f.deadlines.generation![0]).toBeLessThanOrEqual(started + 90100);
        expect(f.deadlines.judge![0]).toBeLessThanOrEqual(started + 120100);
        expect(f.repository.beginProviderAttempt).toHaveBeenCalledWith(
            expect.anything(),
            "run",
            expect.objectContaining({
                stage: "generation",
                attempt: 2,
                snapshotHash: expect.any(String),
                expectedActiveId: null,
            })
        );
    } finally {
        f.restore();
    }
});
it.each(["revoke", "creation", "late_creation"] as const)(
    "stops a physical retry after %s changes and persists safe attempt counts",
    async mode => {
        const f = fixture(mode);
        try {
            await expect(f.run()).rejects.toThrow(
                mode === "revoke" ? "source_authority_changed" : "weekly_review_disabled"
            );
            expect(f.repository.accept).not.toHaveBeenCalled();
            expect(f.repository.completeProviderAttempt).toHaveBeenCalledTimes(5);
            if (mode === "late_creation")
                expect(f.repository.completeProviderAttempt).toHaveBeenLastCalledWith(
                    expect.anything(),
                    "run",
                    "generation-1",
                    { statusClass: "aborted", httpStatus: null },
                    undefined
                );
            expect(f.repository.fail).toHaveBeenCalledWith(
                f.actor,
                "run",
                expect.any(String),
                expect.objectContaining({
                    stage: "generation",
                    counts: expect.objectContaining({
                        providerAttempts: 5,
                        providerFailures: 3,
                        messageBytes: 123,
                    }),
                })
            );
        } finally {
            f.restore();
        }
    }
);
it.each(["raw", "typed"] as const)(
    "persists %s terminal failures without response or validator text",
    async mode => {
        const f = fixture(mode);
        try {
            await expect(f.run()).rejects.toThrow("candidate_not_admitted");
            const failure = f.repository.fail.mock.calls[0] as unknown as unknown[];
            expect(failure[3]).toMatchObject({
                stage: mode === "typed" ? "generation_validation" : "generation",
                validatorCodes: mode === "typed" ? ["invalid_source_citation"] : [],
                counts: {
                    providerAttempts: 6,
                    providerFailures: 3,
                    messageBytes: 123,
                    citationsChecked: mode === "typed" ? 3 : null,
                    citationsFailed: mode === "typed" ? 1 : null,
                },
            });
            expect(JSON.stringify([failure, f.errorLog.mock.calls])).not.toMatch(
                /PRIVATE_SOURCE|PRIVATE_PROVIDER_RESPONSE|PRIVATE_ERROR_CODE|PRIVATE_VALIDATOR_TEXT/
            );
        } finally {
            f.restore();
        }
    }
);
it("bounds an ignoring stage by the original run deadline", async () => {
    jest.useFakeTimers();
    const f = fixture("deadline");
    try {
        const work = f.run();
        const rejection = expect(work).rejects.toThrow("review_deadline_exceeded");
        await jest.advanceTimersByTimeAsync(540000);
        await rejection;
        expect(f.repository.accept).not.toHaveBeenCalled();
        expect(f.repository.fail).toHaveBeenCalledWith(
            f.actor,
            "run",
            "review_deadline_exceeded",
            expect.objectContaining({ stage: "judge", statusClass: "timeout" })
        );
    } finally {
        f.restore();
        jest.useRealTimers();
    }
});
