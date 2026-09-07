import type * as ApplicationModule from "~/server/call-notes/application";
import { enrichmentReadyCall } from "~/app/calls/_fixtures/callSnapshots";
import { EnrichmentStreamEventSchema } from "~/lib/call-notes-enrichment-stream";

const mockAuth = jest.fn();
const mockGetCall = jest.fn();
const mockReadRun = jest.fn();
jest.mock("@clerk/nextjs/server", () => ({ auth: (): unknown => mockAuth() }));
jest.mock("~/lib/active-workspace", () => ({ getActiveCompanyId: async () => 42n }));
jest.mock("~/server/engine", () => ({
    getEngine: () => ({
        db: { select: () => ({ from: () => ({ where: () => ({ limit: mockReadRun }) }) }) },
    }),
}));
jest.mock("~/server/call-notes/application", () => ({
    ...jest.requireActual<typeof ApplicationModule>("~/server/call-notes/application"),
    getWebCallNotesApplication: () => ({ getCall: mockGetCall }),
}));

import { GET } from "~/app/api/call-notes/[callId]/enrichment/stream/route";

const ready = enrichmentReadyCall;
const generating = {
    ...ready,
    enrichment: {
        ...ready.enrichment!,
        status: "generating",
        proposal: null,
        modelMetadata: null,
        resolvedAt: null,
    },
};
const params = { params: Promise.resolve({ callId: ready.id }) };
function request(signal?: AbortSignal) {
    return new Request(
        `http://localhost/api/call-notes/${ready.id}/enrichment/stream?run=${ready.enrichment!.id}`,
        { signal }
    );
}
async function nextEvent(reader: ReadableStreamDefaultReader<Uint8Array>) {
    const { done, value } = await reader.read();
    if (done) throw new Error("Stream closed before the expected event");
    const body: unknown = JSON.parse(new TextDecoder().decode(value).slice(6).trim());
    return EnrichmentStreamEventSchema.parse(body);
}
beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: "owner" });
    mockGetCall.mockResolvedValue(generating);
    mockReadRun.mockResolvedValue([{ status: "generating", previewMarkdown: "## Live section" }]);
});
afterEach(() => {
    jest.useRealTimers();
});

it("replays persisted text before completion and refreshes a snapshot that races the terminal write", async () => {
    const response = await GET(request(), params);
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    try {
        expect(await nextEvent(reader)).toMatchObject({
            type: "progress",
            status: "generating",
            markdown: "## Live section",
        });
        mockGetCall.mockResolvedValueOnce(generating).mockResolvedValue(ready);
        mockReadRun.mockResolvedValue([
            { status: "ready", previewMarkdown: "## Complete section" },
        ]);
        await jest.advanceTimersByTimeAsync(500);
        const event = await nextEvent(reader);
        expect(event.type).toBe("complete");
        if (event.type !== "complete") throw new Error("Expected a validated terminal snapshot");
        expect(event.snapshot.enrichment?.status).toBe("ready");
        expect(event.snapshot.enrichment?.proposal).not.toBeNull();
        expect((await reader.read()).done).toBe(true);
    } finally {
        await reader.cancel();
    }
});

it("stops without exposing new preview text when note visibility is revoked", async () => {
    const response = await GET(request(), params);
    const reader = response.body!.getReader();
    try {
        await nextEvent(reader);
        mockGetCall.mockResolvedValue({ ...generating, note: null, enrichment: null });
        mockReadRun.mockResolvedValue([
            { status: "generating", previewMarkdown: "newly private secret" },
        ]);
        await jest.advanceTimersByTimeAsync(500);
        const event = await nextEvent(reader);
        expect(event.type).toBe("error");
        expect(JSON.stringify(event)).not.toContain("newly private secret");
        expect((await reader.read()).done).toBe(true);
    } finally {
        await reader.cancel();
    }
});

it("does not expose previews to an unauthenticated caller or a redacted note viewer", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    expect((await GET(request(), params)).status).toBe(401);
    mockAuth.mockResolvedValue({ userId: "another-viewer" });
    mockGetCall.mockResolvedValue({ ...generating, note: null, enrichment: null });
    const response = await GET(request(), params);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("Live section");
});

it("closes an already-aborted request without starting a polling stream", async () => {
    const abort = new AbortController();
    abort.abort();
    const response = await GET(request(abort.signal), params);
    expect((await response.body!.getReader().read()).done).toBe(true);
    const reads = mockGetCall.mock.calls.length;
    await jest.advanceTimersByTimeAsync(2_000);
    expect(mockGetCall.mock.calls).toHaveLength(reads);
});

it("releases polling on disconnect without changing the independent generating run", async () => {
    const response = await GET(request(), params);
    const reader = response.body!.getReader();
    await nextEvent(reader);
    await reader.cancel();
    const reads = mockGetCall.mock.calls.length;
    await jest.advanceTimersByTimeAsync(2_000);
    expect(mockGetCall.mock.calls).toHaveLength(reads);
    const reconnected = await GET(request(), params);
    const nextReader = reconnected.body!.getReader();
    try {
        expect(await nextEvent(nextReader)).toMatchObject({
            type: "progress",
            status: "generating",
            markdown: "## Live section",
        });
    } finally {
        await nextReader.cancel();
    }
});
