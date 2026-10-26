/** @jest-environment jsdom */

/**
 * The post writer's screen against a scripted server: Generate queues a run
 * and follows it by polling, the stepper fills from the stored events, and the
 * result lands as before. A page opened while a run is still going (the tab
 * was closed or reloaded mid-run) finds it and picks it up instead of losing
 * it — the failure the old single SSE request could not survive.
 */
import { act, renderHook, waitFor } from "@testing-library/react";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));

import { useMarketingPipelineController } from "~/app/employer/documents/components/marketing-pipeline/useMarketingPipelineController";

type Json = Record<string, unknown>;

const RESULT = {
    platform: "linkedin",
    message: "Light roast, origin first.",
    "image/video": "image",
    research: [],
    normalizedInput: { platform: "linkedin", prompt: "Announce the roast" },
    variants: [{ variantId: "v1", message: "Light roast, origin first.", mediaType: "image" }],
};

const EVENTS = [
    { type: "step_start", step: "loading-context", label: "Loading company knowledge" },
    { type: "step_complete", step: "loading-context", durationMs: 900, detail: "Loaded" },
    { type: "step_thinking", step: "loading-context", text: "Searching the knowledge base…" },
    { type: "step_start", step: "generating-content", label: "Writing" },
    { type: "step_complete", step: "generating-content", durationMs: 4000 },
];

function view(status: string, from: number, to: number, extra: Json = {}): Json {
    return {
        id: "run-1",
        status,
        input: { platform: "linkedin", prompt: "Announce the roast" },
        events: EVENTS.slice(from, to),
        eventCount: to,
        result: status === "completed" ? RESULT : null,
        error: null,
        ...extra,
    };
}

// jsdom has no fetch Response; the controller only reads these three.
const urlOf = (input: RequestInfo | URL) =>
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

const respond = (data: Json, status = 200) =>
    Promise.resolve({
        ok: status < 400,
        status,
        json: async () => ({ success: true, data }),
        text: async () => JSON.stringify({ success: true, data }),
    } as unknown as Response);

let polls: string[] = [];
let script: Array<(url: string) => Promise<Response>> = [];

beforeEach(() => {
    jest.useFakeTimers();
    polls = [];
    script = [];
    sessionStorage.clear();
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = urlOf(input);
        if (url.startsWith("/api/marketing-pipeline/runs/")) {
            polls.push(url);
            const next = script.shift();
            if (!next) throw new Error(`unexpected poll ${url}`);
            return next(url);
        }
        if (url === "/api/marketing-pipeline/runs" && init?.method === "POST")
            return respond({ run: view("queued", 0, 0) }, 202);
        if (url === "/api/marketing-pipeline/runs") return respond({ runs: [] });
        throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;
});

afterEach(() => {
    jest.useRealTimers();
});

async function tick() {
    await act(async () => {
        await jest.advanceTimersByTimeAsync(1100);
    });
}

it("queues a run, follows it by polling with a cursor, and shows the result", async () => {
    script = [
        () => respond({ run: view("running", 0, 3) }),
        () => respond({ run: view("running", 3, 4) }),
        () => respond({ run: view("completed", 4, 5) }),
    ];
    const { result } = renderHook(() => useMarketingPipelineController({ debug: false }));
    await act(async () => {
        result.current.setPlatform("linkedin");
        result.current.setPrompt("Announce the roast");
    });

    let run!: Promise<void>;
    act(() => {
        run = result.current.runPipeline();
    });
    await waitFor(() => expect(polls).toHaveLength(1));
    expect(result.current.loading).toBe(true);
    expect(result.current.pipelineSteps.find(s => s.id === "loading-context")?.status).toBe(
        "completed"
    );
    expect(result.current.thinkingLog).toHaveLength(1);

    await tick();
    await tick();
    await act(async () => {
        await run;
    });

    // The cursor advanced with every poll: no event was read twice.
    expect(polls).toEqual([
        "/api/marketing-pipeline/runs/run-1?after=0",
        "/api/marketing-pipeline/runs/run-1?after=3",
        "/api/marketing-pipeline/runs/run-1?after=4",
    ]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.editableMessage).toBe("Light roast, origin first.");
    expect(result.current.pipelineSteps.find(s => s.id === "generating-content")?.status).toBe(
        "completed"
    );
});

it("a page opened mid-run picks the run up instead of losing it", async () => {
    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
        const url = urlOf(input);
        if (url === "/api/marketing-pipeline/runs")
            return respond({ runs: [view("running", 3, 3, { events: [] })] });
        polls.push(url);
        const next = script.shift();
        if (!next) throw new Error(`unexpected poll ${url}`);
        return next(url);
    });
    script = [
        // The replay from the start: everything the run said before the reload.
        () => respond({ run: view("running", 0, 4) }),
        () => respond({ run: view("completed", 4, 5) }),
    ];
    const { result } = renderHook(() => useMarketingPipelineController({ debug: false }));
    await waitFor(() => expect(polls).toHaveLength(1));
    expect(result.current.loading).toBe(true);
    expect(result.current.platform).toBe("linkedin");
    expect(result.current.prompt).toBe("Announce the roast");
    await tick();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(polls[0]).toBe("/api/marketing-pipeline/runs/run-1?after=0");
    expect(result.current.editableMessage).toBe("Light roast, origin first.");
});

it("a run that failed for good shows its reason and stops polling", async () => {
    script = [
        () => respond({ run: view("failed", 0, 2, { error: "Failed to run marketing pipeline" }) }),
    ];
    const { result } = renderHook(() => useMarketingPipelineController({ debug: false }));
    await act(async () => {
        result.current.setPlatform("linkedin");
        result.current.setPrompt("Announce the roast");
    });
    await act(async () => {
        await result.current.runPipeline();
    });
    expect(result.current.error).toBe("Failed to run marketing pipeline");
    expect(result.current.loading).toBe(false);
    await tick();
    expect(polls).toHaveLength(1);
});
