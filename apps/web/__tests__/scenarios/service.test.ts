/**
 * Scenarios access rules and money: a run is private to its creator until
 * shared; only the creator manages it; a shared reader sees evidence from
 * files they can't open redacted; post tests need social.publish and link to
 * a post only when the composed text is the tested text; runs refuse to start
 * without credits when metering is enforced.
 */
import type * as MockRequireWorkspaceContext from "../helpers/mock-require-workspace-context";

import { createWorld, type World } from "@launchstack/simulation";
import { hashDraft, type ScenarioRunRecord } from "@launchstack/pipelines/scenarios";

import type { WorkspaceContextResult } from "~/lib/require-workspace-context";
import { SCENARIO_LIMITS } from "~/lib/scenarios/types";

import { makeWorkspaceContext } from "../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn<Promise<WorkspaceContextResult>, []>();
// The AI-allowance gate reads the meter; these tests don't model limits.
jest.mock("~/server/ai-usage/refusal", () => ({
    assertWithinAiAllowance: jest.fn(async () => undefined),
}));
jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

jest.mock("@launchstack/pipelines/scenarios/db", () => {
    const fns = {
        getCompanyRun: jest.fn(),
        listVisibleRuns: jest.fn(),
        createScenarioRun: jest.fn(),
        updateRunMeta: jest.fn(),
        deleteRun: jest.fn(),
        requestCancel: jest.fn(),
        listInjections: jest.fn(),
        listInterviews: jest.fn(),
        addInjectionIfOpen: jest.fn(),
        addInterview: jest.fn(),
        linkPostTest: jest.fn(),
        listLinkedPostTests: jest.fn(),
        finish: jest.fn(),
    };
    return { ...fns, createScenarioStore: () => ({ finish: fns.finish }) };
});

const mockComplete = jest.fn();
jest.mock("@launchstack/pipelines/scenarios", () => ({
    ...jest.requireActual<object>("@launchstack/pipelines/scenarios"),
    createLlmSimulationModel: () => ({ complete: (...args: unknown[]) => mockComplete(...args) }),
}));

jest.mock("~/server/scenarios/executor", () => ({
    dispatchRun: jest.fn(),
    resumeIfStalled: jest.fn(),
    readScenariosExecutor: jest.fn(() => "inline"),
}));
jest.mock("~/server/scenarios/evidence", () => ({
    visibleDocumentIds: jest.fn(),
    brandIdentity: jest.fn(),
}));
jest.mock("~/server/profile/store", () => ({
    workspaceLooks: jest.fn(async (_c: bigint, ids: Iterable<string>) => {
        const out = new Map();
        for (const id of ids)
            out.set(id, { displayName: id === "creator" ? "Ana" : "Bo", member: id !== "gone" });
        return out;
    }),
}));
jest.mock("~/lib/credits", () => ({ getBalance: jest.fn(), debitTokens: jest.fn() }));
jest.mock("~/server/deployment", () => ({ isMeteringEnforced: jest.fn(() => false) }));
jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("~/server/workspace-models/scope", () => ({
    withWorkspaceChatModels: jest.fn((_companyId: unknown, _feature: unknown, fn: () => unknown) =>
        fn()
    ),
}));

type Mocks<K extends string> = Record<K, jest.Mock>;
const mockDb = jest.requireMock<
    Mocks<
        | "getCompanyRun"
        | "createScenarioRun"
        | "updateRunMeta"
        | "requestCancel"
        | "listInjections"
        | "listInterviews"
        | "addInjectionIfOpen"
        | "addInterview"
        | "linkPostTest"
        | "finish"
    >
>("@launchstack/pipelines/scenarios/db");
const mockExecutor = jest.requireMock<Mocks<"dispatchRun" | "resumeIfStalled">>(
    "~/server/scenarios/executor"
);
const mockEvidence = jest.requireMock<Mocks<"visibleDocumentIds" | "brandIdentity">>(
    "~/server/scenarios/evidence"
);
const mockCredits = jest.requireMock<Mocks<"getBalance" | "debitTokens">>("~/lib/credits");
const mockMetering = jest.requireMock<Mocks<"isMeteringEnforced">>("~/server/deployment");

import { POST as createRoute } from "~/app/api/scenarios/route";
import {
    addScenarioEvent,
    askScenario,
    cancelScenario,
    createPostTest,
    createScenario,
    getScenarioDetail,
    linkComposedPosts,
    ScenarioError,
    titleFromSubject,
    updateScenario,
} from "~/server/scenarios/service";

function world(): World {
    const w = createWorld({
        subject: "Price rise",
        brief: "Background.",
        personas: [
            {
                id: "a1",
                name: "Cy",
                handle: "@cy",
                role: "Founder",
                bio: "b",
                interests: [],
                stance: 1,
                activity: 1,
                influence: 0.2,
                grounding: "grounded",
                sourceIds: ["E1"],
            },
            {
                id: "a2",
                name: "Di",
                handle: "@di",
                role: "Analyst",
                bio: "b",
                interests: [],
                stance: -1,
                activity: 1,
                influence: 0.2,
                grounding: "invented",
                sourceIds: [],
            },
        ],
        accounts: [{ id: "narrator", name: "Newswire", handle: "@newswire" }],
        seedPosts: [{ authorId: "narrator", text: "Acme raises prices." }],
    });
    return w;
}

function run(overrides: Partial<ScenarioRunRecord> = {}): ScenarioRunRecord {
    return {
        id: 3,
        companyId: 5n,
        createdByUserId: "creator",
        kind: "scenario",
        title: "Price rise",
        subject: "We raise prices.",
        status: "running",
        step: 3,
        agentCount: 2,
        roundCount: 4,
        seed: 1,
        sources: {
            documentIds: [7],
            searchFiles: false,
            prospects: false,
            brandComments: false,
            companyProfile: false,
            notes: "",
        },
        evidence: [
            {
                id: "E1",
                kind: "document",
                label: "Board memo.pdf",
                text: "Secret margin plan.",
                ref: { type: "document", id: "7" },
                href: "/employer/documents?docId=7",
                documentIds: [7],
            },
            {
                id: "E2",
                kind: "notes",
                label: "Pasted material",
                text: "Public news.",
                ref: { type: "notes", id: "1" },
                href: null,
                documentIds: [],
            },
        ],
        brief: { brief: "Margins [E1].", openingPost: "Acme raises prices.", evidenceIds: ["E1"] },
        world: { ...world(), round: 1 },
        report: null,
        reception: null,
        estimate: { calls: 10, inputTokens: 100, outputTokens: 10, credits: 110 },
        usage: { calls: 4, inputTokens: 40, outputTokens: 4, credits: 44 },
        draft: null,
        draftHash: null,
        error: null,
        sharedAt: null,
        cancelRequestedAt: null,
        leaseUntil: null,
        createdAt: new Date("2026-10-17T00:00:00Z"),
        startedAt: null,
        finishedAt: null,
        eventsClosedAt: null,
        ...overrides,
    };
}

const as = (authUserId: string, role = "member") =>
    makeWorkspaceContext({ authUserId, role, companyId: 5n });

beforeEach(() => {
    jest.clearAllMocks();
    mockDb.listInjections.mockResolvedValue([]);
    mockDb.listInterviews.mockResolvedValue([]);
    mockEvidence.visibleDocumentIds.mockResolvedValue(new Set<number>());
    mockMetering.isMeteringEnforced.mockReturnValue(false);
});

async function expectError(promise: Promise<unknown>, status: number, code?: string) {
    const err = await promise.then(
        () => undefined,
        (e: unknown) => e
    );
    expect(err).toBeInstanceOf(ScenarioError);
    expect((err as ScenarioError).status).toBe(status);
    if (code) expect((err as ScenarioError).code).toBe(code);
}

describe("reading a run", () => {
    it("is 404 for anyone but the creator until it is shared", async () => {
        mockDb.getCompanyRun.mockResolvedValue(run());
        await expectError(getScenarioDetail(as("someone"), 3), 404, "not_found");
        const detail = await getScenarioDetail(as("creator"), 3);
        expect(detail).toMatchObject({
            createdByMe: true,
            canManage: true,
            createdByName: "Ana",
            round: 1,
            stage: "simulating",
        });
        expect(detail.sources[0]).toMatchObject({ label: "Board memo.pdf", redacted: false });
        expect(mockExecutor.resumeIfStalled).toHaveBeenCalled();
    });

    it("redacts evidence from files a shared reader can't open, and keeps the rest", async () => {
        mockDb.getCompanyRun.mockResolvedValue(run({ sharedAt: new Date() }));
        const detail = await getScenarioDetail(as("someone"), 3);
        expect(mockEvidence.visibleDocumentIds).toHaveBeenCalledWith(5n, expect.anything(), [7]);
        expect(detail.canManage).toBe(false);
        expect(detail.sources).toEqual([
            {
                id: "E1",
                kind: "document",
                label: "A file you don't have access to",
                excerpt: null,
                href: null,
                redacted: true,
            },
            {
                id: "E2",
                kind: "notes",
                label: "Pasted material",
                excerpt: "Public news.",
                href: null,
                redacted: false,
            },
        ]);
        expect(detail.people.map(p => [p.handle, p.grounding])).toEqual([
            ["@cy", "grounded"],
            ["@di", "invented"],
        ]);
        expect(detail.posts[0]).toMatchObject({ id: "p1", authorKind: "narrator", kind: "seed" });
    });

    it("shows a file to a shared reader who can open it", async () => {
        mockDb.getCompanyRun.mockResolvedValue(run({ sharedAt: new Date() }));
        mockEvidence.visibleDocumentIds.mockResolvedValue(new Set([7]));
        expect((await getScenarioDetail(as("someone"), 3)).sources[0]!.redacted).toBe(false);
    });
});

describe("managing a run", () => {
    it("lets only the creator rename or share", async () => {
        mockDb.getCompanyRun.mockResolvedValue(run({ sharedAt: new Date() }));
        await expectError(updateScenario(as("someone"), 3, { shared: false }), 403, "forbidden");
        await updateScenario(as("creator"), 3, { shared: true, title: " New " });
        expect(mockDb.updateRunMeta).toHaveBeenCalledWith(
            5n,
            3,
            { title: "New", shared: true },
            expect.any(Date)
        );
    });

    it("stops a run nobody is executing at once, inline", async () => {
        mockDb.getCompanyRun.mockResolvedValue(run());
        await cancelScenario(as("creator"), 3);
        expect(mockDb.requestCancel).toHaveBeenCalled();
        expect(mockDb.finish).toHaveBeenCalledWith(3, "cancelled", null, expect.any(Date));
    });

    it("leaves a run with a live lease to stop at its next unit", async () => {
        mockDb.getCompanyRun.mockResolvedValue(run({ leaseUntil: new Date(Date.now() + 60_000) }));
        await cancelScenario(as("creator"), 3);
        expect(mockDb.requestCancel).toHaveBeenCalled();
        expect(mockDb.finish).not.toHaveBeenCalled();
    });

    it("takes events only while rounds are left", async () => {
        mockDb.getCompanyRun.mockResolvedValue(run({ status: "done" }));
        await expectError(addScenarioEvent(as("creator"), 3, "A rival cuts prices."), 409);
        mockDb.getCompanyRun.mockResolvedValue(run({ step: 6 }));
        await expectError(addScenarioEvent(as("creator"), 3, "A rival cuts prices."), 409);
        mockDb.getCompanyRun.mockResolvedValue(run());
        mockDb.addInjectionIfOpen.mockResolvedValue({
            id: 1,
            text: "A rival cuts prices.",
            appliedRound: null,
            createdAt: new Date(),
        });
        expect(await addScenarioEvent(as("creator"), 3, " A rival cuts prices. ")).toMatchObject({
            round: null,
        });
        expect(mockDb.addInjectionIfOpen).toHaveBeenCalledWith(
            expect.objectContaining({ text: "A rival cuts prices." })
        );
        // The final round closed the window between the check and the insert.
        mockDb.addInjectionIfOpen.mockResolvedValue(undefined);
        await expectError(addScenarioEvent(as("creator"), 3, "Too late."), 409, "not_running");
        // Already closed when read.
        mockDb.getCompanyRun.mockResolvedValue(run({ eventsClosedAt: new Date() }));
        await expectError(addScenarioEvent(as("creator"), 3, "Too late."), 409);
    });
});

describe("starting a run", () => {
    beforeEach(() => {
        mockDb.createScenarioRun.mockImplementation(async (input: Partial<ScenarioRunRecord>) =>
            run({ ...input, status: "queued", step: 0, world: null })
        );
    });

    it("validates, clamps size, drops files the creator can't open, and dispatches", async () => {
        await expectError(createScenario(as("creator"), { subject: "  " }), 400, "invalid");
        mockEvidence.visibleDocumentIds.mockResolvedValue(new Set([7]));
        await createScenario(as("creator"), {
            subject: "We raise prices.",
            agents: 5000,
            rounds: 0,
            sources: {
                documentIds: [7, 8],
                searchFiles: true,
                prospects: false,
                brandComments: false,
                companyProfile: false,
                notes: "",
            },
        });
        const input = mockDb.createScenarioRun.mock.calls[0]![0];
        expect(input).toMatchObject({
            kind: "scenario",
            agentCount: 200,
            roundCount: 1,
            title: "We raise prices.",
        });
        expect(input.sources.documentIds).toEqual([7]);
        expect(mockExecutor.dispatchRun).toHaveBeenCalled();
    });

    it("refuses with 402 when metering is enforced and the balance is short", async () => {
        mockMetering.isMeteringEnforced.mockReturnValue(true);
        mockCredits.getBalance.mockResolvedValue(10);
        mockRequireWorkspaceContext.mockResolvedValue({ success: true, data: as("creator") });
        const res = await createRoute(
            new Request("http://x/api/scenarios", {
                method: "POST",
                body: JSON.stringify({ subject: "We raise prices." }),
            }) as never
        );
        expect(res.status).toBe(402);
        const body = (await res.json()) as { code: string; required: number };
        expect(body.code).toBe("insufficient_credits");
        expect(body.required).toBeGreaterThan(10);
        expect(mockDb.createScenarioRun).not.toHaveBeenCalled();
    });

    it("needs documents.read", async () => {
        await expectError(
            createScenario(makeWorkspaceContext({ authUserId: "x", permissions: [] }), {
                subject: "s",
            }),
            403
        );
    });

    it("takes a situation of a few paragraphs, up to the limit", async () => {
        mockEvidence.visibleDocumentIds.mockResolvedValue(new Set());
        const plan = [
            "We launch the Pro plan at $49 a month in March.",
            `The plan: ${"bundle onboarding and priority support, ".repeat(40)}`,
            "Where things stand: three pilot customers renewed, one churned over price.",
        ].join("\n\n");
        expect(plan.length).toBeGreaterThan(600);
        await createScenario(as("creator"), { subject: plan });
        expect(mockDb.createScenarioRun.mock.calls[0]![0]).toMatchObject({
            subject: plan,
            title: "We launch the Pro plan at $49 a month in March.",
        });
        await expectError(
            createScenario(as("creator"), { subject: "x".repeat(SCENARIO_LIMITS.subjectMax + 1) }),
            400,
            "invalid"
        );
    });
});

describe("titleFromSubject", () => {
    it("is the first line, cut at a word when it runs long", () => {
        expect(titleFromSubject("We raise prices.\n\nThe plan…")).toBe("We raise prices.");
        const long = titleFromSubject(`We launch ${"a bundled onboarding offer ".repeat(10)}`);
        expect(long.length).toBeLessThanOrEqual(120);
        expect(long).toMatch(/^We launch a bundled onboarding offer .*[a-z]…$/);
    });
});

describe("interviews", () => {
    it("open after round 1, bill the workspace and keep the answer", async () => {
        mockDb.getCompanyRun.mockResolvedValue(run({ world: world() }));
        await expectError(askScenario(as("creator"), 3, "a1", "Why?"), 409, "not_ready");
        mockDb.getCompanyRun.mockResolvedValue(run());
        await expectError(askScenario(as("creator"), 3, "a9", "Why?"), 400);
        mockComplete.mockResolvedValue({
            text: "A: Because of margins.",
            usage: { inputTokens: 300, outputTokens: 20 },
        });
        mockDb.addInterview.mockImplementation(async (row: object) => ({
            id: 1,
            createdAt: new Date(),
            ...row,
        }));
        const answer = await askScenario(as("creator"), 3, "analyst", "Who moved?");
        expect(answer).toMatchObject({ agentId: "analyst", answer: "Because of margins." });
        expect(mockCredits.debitTokens).toHaveBeenCalledWith(
            expect.objectContaining({ amount: 320, service: "scenario_simulation" })
        );
        // The answer comes from the workspace's own models when it brings them.
        const { withWorkspaceChatModels } = jest.requireMock<{
            withWorkspaceChatModels: jest.Mock;
        }>("~/server/workspace-models/scope");
        expect(withWorkspaceChatModels).toHaveBeenCalledWith(
            5n,
            { feature: "scenarios", userId: "creator" },
            expect.any(Function)
        );
    });
});

describe("post tests", () => {
    it("need social.publish and store the hashed draft", async () => {
        await expectError(
            createPostTest(as("viewer-1", "viewer"), { text: "Hi", networks: ["linkedin"] }),
            403
        );
        mockEvidence.brandIdentity.mockResolvedValue({ name: "Acme", handle: "@acme" });
        mockDb.createScenarioRun.mockImplementation(async (input: Partial<ScenarioRunRecord>) =>
            run({ ...input, status: "queued", step: 0, world: null })
        );
        const test = await createPostTest(as("creator"), {
            text: " We shipped it. ",
            networks: ["linkedin", "myspace"],
        });
        const input = mockDb.createScenarioRun.mock.calls[0]![0];
        expect(input).toMatchObject({
            kind: "post_test",
            agentCount: 20,
            roundCount: 3,
            draftHash: hashDraft("We shipped it."),
        });
        expect(input.draft).toEqual({
            text: "We shipped it.",
            networks: ["linkedin"],
            brandName: "Acme",
            brandHandle: "@acme",
        });
        expect(test).toMatchObject({ status: "queued", text: "We shipped it." });
    });

    it("link to composed posts only when the text is unchanged and the test is done", async () => {
        const tested = run({
            kind: "post_test",
            status: "done",
            draftHash: hashDraft("We shipped it."),
            draft: {
                text: "We shipped it.",
                networks: [],
                brandName: "Acme",
                brandHandle: "@acme",
            },
        });
        mockDb.getCompanyRun.mockResolvedValue(tested);
        const ctx = { companyId: 5n, authUserId: "creator" };
        expect(await linkComposedPosts(ctx, 3, "We shipped it!", ["bp1"])).toEqual({
            runId: 3,
            linked: false,
            stale: true,
        });
        expect(mockDb.linkPostTest).not.toHaveBeenCalled();
        expect(await linkComposedPosts(ctx, 3, "We shipped it.\r\n", ["bp1", "bp2"])).toEqual({
            runId: 3,
            linked: true,
            stale: false,
        });
        expect(mockDb.linkPostTest).toHaveBeenCalledWith(5n, 3, ["bp1", "bp2"]);
        expect(
            await linkComposedPosts({ companyId: 5n, authUserId: "other" }, 3, "We shipped it.", [
                "bp1",
            ])
        ).toMatchObject({ linked: false });
        mockDb.getCompanyRun.mockResolvedValue({ ...tested, status: "running" });
        expect(await linkComposedPosts(ctx, 3, "We shipped it.", ["bp1"])).toMatchObject({
            linked: false,
            stale: false,
        });
    });
});
