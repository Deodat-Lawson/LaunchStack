import { NextRequest, NextResponse } from "next/server";
import type { WorkspaceContextResult } from "~/lib/require-workspace-context";
import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockContext = jest.fn<Promise<WorkspaceContextResult>, []>();
const mockCalls: Record<string, jest.Mock> = Object.fromEntries(
    [
        "createEvidence",
        "listEvidence",
        "createCommitmentV1",
        "updateCommitmentV1",
        "deleteCommitmentV1",
        "listCommitmentsV1",
        "addTopicV1",
        "reorderTopicsV1",
        "setAgendaStatusV1",
        "clearDecisionV1",
        "deleteTopicV1",
        "patchTopicV1",
        "decideV1",
        "reviewEnhancement",
        "getAgendaV1",
        "listAgendas",
        "deleteAgenda",
        "createObservationsV1",
        "listObservations",
    ].map(name => [name, jest.fn()])
);

jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: () => mockContext(),
}));
jest.mock("@launchstack/pipelines/vantage", () => ({
    VantageError: class VantageError extends Error {
        readonly status: number;
        readonly code: string;
        constructor(message: string, status: number, code: string) {
            super(message);
            this.status = status;
            this.code = code;
        }
    },
    VANTAGE_EVIDENCE_KINDS: ["note", "interview", "link", "task", "claim", "document"],
    VANTAGE_VISIBILITIES: ["private", "shared"],
    VANTAGE_COMMITMENT_STATUSES: ["open", "done", "missed", "dropped"],
    validDate: (s: unknown) =>
        typeof s === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(s) &&
        Number.isFinite(Date.parse(s)) &&
        new Date(s).toISOString().slice(0, 10) === s,
    ...Object.fromEntries(
        [
            "createEvidence",
            "listEvidence",
            "createCommitmentV1",
            "updateCommitmentV1",
            "deleteCommitmentV1",
            "listCommitmentsV1",
            "addTopicV1",
            "reorderTopicsV1",
            "setAgendaStatusV1",
            "clearDecisionV1",
            "deleteTopicV1",
            "patchTopicV1",
            "decideV1",
            "reviewEnhancement",
            "getAgendaV1",
            "listAgendas",
            "deleteAgenda",
            "createObservationsV1",
            "listObservations",
        ].map(name => [name, (...args: unknown[]) => mockCalls[name]!(...args)])
    ),
}));
jest.mock("~/server/vantage/service-v1", () => ({
    prepareWeekV1: jest.fn(),
    loadOverviewV1: jest.fn(),
}));

import { VantageError } from "@launchstack/pipelines/vantage";
import {
    DecisionSchema,
    CommitmentSchema,
    CommitmentPatchSchema,
} from "~/app/api/vantage/_schemas";
import { POST as createAction } from "~/app/api/vantage/commitments/route";
import { PATCH as updateAction } from "~/app/api/vantage/commitments/[id]/route";
import { POST as addTopic } from "~/app/api/vantage/agendas/[id]/topics/route";
import { POST as reorder } from "~/app/api/vantage/agendas/[id]/reorder/route";
import { PATCH as setStatus } from "~/app/api/vantage/agendas/[id]/route";
import {
    POST as decide,
    DELETE as clearDecision,
} from "~/app/api/vantage/topics/[id]/decide/route";
import { POST as addEvidence, GET as readEvidence } from "~/app/api/vantage/evidence/route";
import { GET as exportAgenda } from "~/app/api/vantage/agendas/[id]/update/route";
import { GET as triage } from "~/app/api/vantage/triage/route";
import { POST as addObservation } from "~/app/api/vantage/metrics/observations/route";

const savedEnv = { ...process.env };
const action = {
    title: "Interview users",
    owner: "Founder",
    dueOn: "2026-10-20",
    test: "Five interviews recorded",
};
const params = { params: Promise.resolve({ id: "record-1", enhancementId: "addition-1" }) };
function request(body: unknown, headers: Record<string, string> = {}) {
    return new NextRequest("http://localhost/api/vantage/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
    });
}
function signIn(overrides: Parameters<typeof makeWorkspaceContext>[0] = {}) {
    mockContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ companyId: 42n, authUserId: "operator", ...overrides }),
    });
}
beforeEach(() => {
    jest.clearAllMocks();
    process.env.VANTAGE_TEST_MODE = "true";
    process.env.VANTAGE_TEST_COMPANY_ID = "42";
    process.env.VANTAGE_TEST_USER_IDS = "operator";
    process.env.DATABASE_URL = "postgres://test:test@localhost:55434/vantage_test";
    process.env.VANTAGE_TEST_DATABASE_URL = process.env.DATABASE_URL;
    signIn();
});
afterEach(() => {
    process.env = { ...savedEnv };
});

const routeModules = [
    "agendas/route",
    "agendas/[id]/route",
    "agendas/[id]/topics/route",
    "agendas/[id]/reorder/route",
    "agendas/[id]/update/route",
    "topics/[id]/route",
    "topics/[id]/decide/route",
    "topics/[id]/enhancements/[enhancementId]/route",
    "commitments/route",
    "commitments/[id]/route",
    "evidence/route",
    "evidence/[id]/route",
    "metrics/route",
    "metrics/[id]/route",
    "metrics/observations/route",
    "metrics/observations/[id]/route",
    "metrics/import/route",
    "overview/route",
    "deadlines/route",
    "deadlines/[id]/route",
    "triage/route",
];
describe.each(routeModules)("pilot gate: %s", route => {
    const handlers = Object.entries(
        jest.requireActual<Record<string, unknown>>(`~/app/api/vantage/${route}`)
    ).filter(([name]) => ["GET", "POST", "PATCH", "DELETE"].includes(name)) as [
        string,
        (request: NextRequest, context: typeof params) => Promise<Response>,
    ][];
    it.each(handlers)("%s rejects unauthenticated requests", async (_name, handler) => {
        mockContext.mockResolvedValue({
            success: false,
            response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        });
        expect((await handler(request({}), params)).status).toBe(401);
        for (const call of Object.values(mockCalls)) expect(call).not.toHaveBeenCalled();
    });
    it.each(handlers)("%s rejects excluded actors and other workspaces", async (_name, handler) => {
        for (const overrides of [
            { authUserId: "excluded" },
            { companyId: 43n },
            { permissions: ["documents.read"] as const },
            { permissions: ["documents.edit"] as const },
        ]) {
            signIn(overrides);
            const response = await handler(request({}), params);
            expect(response.status).toBe(403);
            expect(await response.json()).toMatchObject({ code: "pilot_access_denied" });
        }
        for (const call of Object.values(mockCalls)) expect(call).not.toHaveBeenCalled();
    });
});

it("takes actor/company only from the session and preserves the v1 envelope", async () => {
    mockCalls.createCommitmentV1!.mockResolvedValue({ id: "action-1", ...action });
    const response = await createAction(request({ ...action, companyId: "43", userId: "forged" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ commitment: { id: "action-1", ...action } });
    expect(mockCalls.createCommitmentV1).toHaveBeenCalledWith({
        companyId: 42n,
        userId: "operator",
        input: action,
    });
});
it.each([undefined, null, "", "  "])("requires a nonempty test on action creation: %p", test => {
    expect(CommitmentSchema.safeParse({ ...action, test }).success).toBe(false);
    expect(
        DecisionSchema.safeParse({ decision: "Proceed", commitment: { ...action, test } }).success
    ).toBe(false);
});
it("lets PATCH omit test but rejects clearing it", () => {
    expect(CommitmentPatchSchema.safeParse({ owner: "New owner" }).success).toBe(true);
    for (const test of [null, "", "  "])
        expect(CommitmentPatchSchema.safeParse({ test }).success).toBe(false);
});
it("rejects invalid dates and sharing before persistence", async () => {
    for (const body of [
        { ...action, dueOn: "2026-02-30" },
        { ...action, shared: true },
    ]) {
        expect((await createAction(request(body))).status).toBe(400);
    }
    expect(mockCalls.createCommitmentV1).not.toHaveBeenCalled();
    expect(
        (
            await addEvidence(
                request({
                    kind: "note",
                    title: "test",
                    body: "synthetic",
                    observedAt: "2026-10-16",
                    visibility: "shared",
                })
            )
        ).status
    ).toBe(400);
    expect(mockCalls.createEvidence).not.toHaveBeenCalled();
});
it("returns scoped missing-record errors without exposing another company", async () => {
    mockCalls.updateCommitmentV1!.mockRejectedValue(
        new VantageError("That commitment is not here.", 404, "not_found")
    );
    const response = await updateAction(request({ owner: "Founder" }), params);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
        error: "That commitment is not here.",
        code: "not_found",
    });
    expect(mockCalls.updateCommitmentV1).toHaveBeenCalledWith({
        companyId: 42n,
        id: "record-1",
        patch: { owner: "Founder" },
    });
});
it("uses v1 functions and DTOs for topic creation, reordering, status and undo", async () => {
    const topic = { id: "topic-1", contentVersion: 2 };
    const agenda = { id: "agenda-1", version: 3, topics: [topic] };
    mockCalls.addTopicV1!.mockResolvedValue(topic);
    mockCalls.reorderTopicsV1!.mockResolvedValue(agenda);
    mockCalls.setAgendaStatusV1!.mockResolvedValue(agenda);
    mockCalls.clearDecisionV1!.mockResolvedValue(topic);
    expect(await (await addTopic(request({ title: "Founder topic" }), params)).json()).toEqual({
        topic,
    });
    expect(await (await reorder(request({ ids: ["topic-1"] }), params)).json()).toEqual({ agenda });
    expect(await (await setStatus(request({ status: "ready" }), params)).json()).toEqual({
        agenda,
    });
    expect(
        await (
            await clearDecision(
                new NextRequest("http://localhost/api/vantage/test?commitment=action-1"),
                params
            )
        ).json()
    ).toEqual({ topic });
    expect(mockCalls.clearDecisionV1).toHaveBeenCalledWith({
        companyId: 42n,
        topicId: "record-1",
        commitmentId: "action-1",
    });
});
it("requires a stable decision key and forwards a valid one", async () => {
    const body = { decision: "Proceed", commitment: action };
    expect((await decide(request(body), params)).status).toBe(400);
    expect(mockCalls.decideV1).not.toHaveBeenCalled();
    mockCalls.decideV1!.mockResolvedValue({ id: "topic-1", contentVersion: 2 });
    expect((await decide(request(body, { "Idempotency-Key": "decision-1" }), params)).status).toBe(
        200
    );
    expect(mockCalls.decideV1).toHaveBeenCalledWith({
        companyId: 42n,
        userId: "operator",
        topicId: "record-1",
        key: "decision-1",
        ...body,
    });
});
it("keeps triage and export disabled for admitted test operators", async () => {
    for (const response of [await exportAgenda(), await triage()]) {
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ code: "sharing_disabled" });
    }
});
it("rejects an invalid evidence since date before querying", async () => {
    const response = await readEvidence(
        new NextRequest("http://localhost/api/vantage/evidence?since=2026-02-30")
    );
    expect(response.status).toBe(400);
    expect(mockCalls.listEvidence).not.toHaveBeenCalled();
});
it("does not expose or log unexpected error details", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
        mockCalls.createCommitmentV1!.mockRejectedValue(
            new Error("secret-provider-key private-source-body")
        );
        const response = await createAction(request(action));
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: "Internal server error" });
        expect(JSON.stringify(log.mock.calls)).not.toMatch(
            /secret-provider-key|private-source-body/
        );
    } finally {
        log.mockRestore();
    }
});

it.each(["{broken", "null", "[]", "42"])("rejects invalid JSON-object bodies: %s", async body => {
    const response = await createAction(
        new NextRequest("http://localhost/api/vantage/commitments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
        })
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "validation_error" });
    expect(mockCalls.createCommitmentV1).not.toHaveBeenCalled();
});

it("uses scoped v1 observation creation and ignores actor/company body fields", async () => {
    mockCalls.createObservationsV1!.mockResolvedValue(1);
    mockCalls.listObservations!.mockResolvedValue([{ id: "observation-1" }]);
    const input = {
        metricId: "metric-1",
        value: 11,
        periodStart: "2026-10-01",
        periodEnd: "2026-10-02",
    };
    const response = await addObservation(request({ ...input, companyId: "43", userId: "forged" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ observations: [{ id: "observation-1" }] });
    expect(mockCalls.createObservationsV1).toHaveBeenCalledWith({
        companyId: 42n,
        userId: "operator",
        inputs: [input],
    });
    expect(mockCalls.listObservations).toHaveBeenCalledWith({ companyId: 42n });
});
