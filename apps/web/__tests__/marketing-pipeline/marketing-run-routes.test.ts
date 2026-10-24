/**
 * The post writer's routes queue and report; they never run the pipeline in
 * the request. POST answers 202 with the queued run, GET of a run is scoped
 * to the caller's workspace and resumes a stalled one, and the list is what a
 * reload uses to find the run in progress.
 */
import type * as NextServer from "next/server";
import type * as Zod from "zod";

const mockCtx = jest.fn();
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: () => mockCtx(),
}));
const mockCreate = jest.fn();
const mockGet = jest.fn();
const mockListActive = jest.fn();
jest.mock("@launchstack/pipelines/marketing/runs", () => ({
    createMarketingRun: (...a: unknown[]) => mockCreate(...a),
    getMarketingRun: (...a: unknown[]) => mockGet(...a),
    listActiveMarketingRuns: (...a: unknown[]) => mockListActive(...a),
}));
jest.mock("@launchstack/pipelines/marketing", () => {
    const { z } = jest.requireActual<typeof Zod>("zod");
    return {
        MarketingPipelineInputSchema: z.object({
            platform: z.enum(["linkedin", "x", "reddit", "bluesky"]),
            prompt: z.string().min(1),
        }),
    };
});
const mockDispatch = jest.fn();
const mockResume = jest.fn();
jest.mock("~/server/marketing/executor", () => ({
    dispatchMarketingRun: (...a: unknown[]) => mockDispatch(...a),
    resumeIfStalled: (...a: unknown[]) => mockResume(...a),
}));

import { NextRequest } from "next/server";

import { GET as GET_RUN } from "~/app/api/marketing-pipeline/runs/[id]/route";
import { GET as LIST, POST } from "~/app/api/marketing-pipeline/runs/route";

const run = (over: Record<string, unknown> = {}) => ({
    id: "run-1",
    companyId: 42n,
    userId: "u1",
    status: "running",
    input: { platform: "linkedin", prompt: "Hi" },
    debug: false,
    events: [
        { type: "step_start", step: "loading-context", label: "Loading" },
        { type: "step_complete", step: "loading-context", durationMs: 5 },
    ],
    checkpoints: { "loading-context": "ctx" },
    result: null,
    errorMessage: null,
    attempts: 1,
    createdAt: new Date("2026-10-24T10:00:00Z"),
    startedAt: null,
    heartbeatAt: null,
    completedAt: null,
    ...over,
});

beforeEach(() => {
    jest.clearAllMocks();
    mockCtx.mockResolvedValue({ success: true, data: { companyId: 42n, authUserId: "u1" } });
});

it("POST queues a run and answers 202 without running anything", async () => {
    mockCreate.mockResolvedValue(run({ status: "queued", events: [] }));
    const res = await POST(
        new Request("http://x/api/marketing-pipeline/runs", {
            method: "POST",
            body: JSON.stringify({ platform: "linkedin", prompt: "Announce" }),
        })
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as { data: { run: { id: string; status: string } } };
    expect(body.data.run).toMatchObject({ id: "run-1", status: "queued" });
    expect(mockCreate).toHaveBeenCalledWith({
        companyId: 42n,
        userId: "u1",
        input: { platform: "linkedin", prompt: "Announce" },
        debug: false,
    });
    expect(mockDispatch).toHaveBeenCalledTimes(1);
});

it("POST refuses bad input before creating anything", async () => {
    const res = await POST(
        new Request("http://x/api/marketing-pipeline/runs", {
            method: "POST",
            body: JSON.stringify({ platform: "myspace" }),
        })
    );
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
});

it("GET of a run returns events after the cursor and checks for a stall", async () => {
    mockGet.mockResolvedValue(run());
    const res = await GET_RUN(
        new NextRequest("http://x/api/marketing-pipeline/runs/run-1?after=1"),
        {
            params: Promise.resolve({ id: "run-1" }),
        }
    );
    const body = (await res.json()) as {
        data: { run: { events: unknown[]; eventCount: number; result: unknown } };
    };
    expect(body.data.run.events).toHaveLength(1);
    expect(body.data.run.eventCount).toBe(2);
    expect(body.data.run.result).toBeNull();
    expect(mockGet).toHaveBeenCalledWith("run-1", 42n);
    expect(mockResume).toHaveBeenCalledTimes(1);
});

it("GET of another workspace's run is not found", async () => {
    mockGet.mockResolvedValue(null);
    const res = await GET_RUN(new NextRequest("http://x/api/marketing-pipeline/runs/run-9"), {
        params: Promise.resolve({ id: "run-9" }),
    });
    expect(res.status).toBe(404);
    expect(mockResume).not.toHaveBeenCalled();
});

it("the list is this member's unfinished runs, without their events", async () => {
    mockListActive.mockResolvedValue([run()]);
    const res = await LIST();
    const body = (await res.json()) as { data: { runs: Array<{ id: string; events: unknown[] }> } };
    expect(body.data.runs.map(r => r.id)).toEqual(["run-1"]);
    expect(body.data.runs[0]!.events).toEqual([]);
    expect(mockListActive).toHaveBeenCalledWith(42n, "u1");
});

it("a signed-out caller gets the auth response", async () => {
    const { NextResponse } = jest.requireActual<typeof NextServer>("next/server");
    mockCtx.mockResolvedValue({ success: false, response: NextResponse.json({}, { status: 401 }) });
    expect((await LIST()).status).toBe(401);
});
