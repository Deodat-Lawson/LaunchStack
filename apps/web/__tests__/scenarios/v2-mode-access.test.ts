/**
 * Contract v2's two promises at the API edge.
 *
 * Context mode is explicit: a new run asks for graph, and gets it only when
 * the graph service is configured, answering, and allowed to see the files;
 * otherwise it is recorded as passage with the reason, never a silent mix.
 *
 * Access: a v2 run's people, provenance, trace and replay are derived from
 * every file it read, so a reader who cannot open one of them (the creator
 * included) is told the run does not exist, without naming what is hidden.
 */
jest.mock("@launchstack/pipelines/scenarios/db", () => ({ getCompanyRun: jest.fn() }));
jest.mock("@launchstack/pipelines/scenarios/v2/read", () => ({
    readActorContexts: jest.fn(async () => []),
    readAttemptCounts: jest.fn(async () => new Map()),
    readCheckpoints: jest.fn(async () => []),
    readGraphSnapshot: jest.fn(async () => undefined),
    readManifest: jest.fn(),
    readNextUnitKinds: jest.fn(async () => new Map()),
    readOntology: jest.fn(async () => undefined),
    readRequestSpec: jest.fn(async () => undefined),
    readTrace: jest.fn(async () => []),
    readUnitOutputs: jest.fn(async () => []),
    readWorldSpec: jest.fn(async () => undefined),
    readWorldSpecWithWorld: jest.fn(async () => undefined),
}));
jest.mock("@launchstack/pipelines/scenarios/v2/db", () => ({
    acceptRun: jest.fn(),
    IdempotencyConflictError: class extends Error {},
    InsufficientCreditsError: class extends Error {},
}));
jest.mock("~/server/scenarios/evidence", () => ({ visibleDocumentIds: jest.fn() }));
jest.mock("~/server/scenarios/v2/graph", () => ({ scenarioGraphPort: jest.fn() }));
jest.mock("~/server/scenarios/v2/executor", () => ({ startV2Run: jest.fn() }));
jest.mock("~/server/scenarios/v2/credits", () => ({ createAppScenarioCredits: jest.fn() }));
jest.mock("~/server/workspace-models/store", () => ({ getWorkspaceEndpointRow: jest.fn() }));
jest.mock("~/server/ai-usage/refusal", () => ({ assertWithinAiAllowance: jest.fn() }));
jest.mock("~/server/deployment", () => ({ isMeteringEnforced: jest.fn(() => false) }));
jest.mock("~/lib/credits", () => ({ getBalance: jest.fn() }));
jest.mock("~/server/scenarios/service", () => {
    class ScenarioError extends Error {
        status: number;
        code: string;
        constructor(message: string, status: number, code: string) {
            super(message);
            this.status = status;
            this.code = code;
        }
    }
    return {
        ScenarioError,
        scenarioErrorCopy: (key: string) => `copy:${key}`,
        cleanScenarioSources: jest.fn(),
        clampInt: jest.fn(),
        titleFromSubject: jest.fn(),
    };
});

import type { ScenarioRunRecord, ScenarioSourcesInput } from "@launchstack/pipelines/scenarios";

import {
    getScenarioProvenance,
    getScenarioTrace,
    replayScenario,
    resolveContextMode,
} from "~/server/scenarios/v2/service";

import { makeWorkspaceContext } from "../helpers/workspace-context";

const { getCompanyRun } = jest.requireMock<{ getCompanyRun: jest.Mock }>(
    "@launchstack/pipelines/scenarios/db"
);
const { readManifest } = jest.requireMock<{ readManifest: jest.Mock }>(
    "@launchstack/pipelines/scenarios/v2/read"
);
const { visibleDocumentIds } = jest.requireMock<{ visibleDocumentIds: jest.Mock }>(
    "~/server/scenarios/evidence"
);
const { scenarioGraphPort } = jest.requireMock<{ scenarioGraphPort: jest.Mock }>(
    "~/server/scenarios/v2/graph"
);
const { getWorkspaceEndpointRow } = jest.requireMock<{ getWorkspaceEndpointRow: jest.Mock }>(
    "~/server/workspace-models/store"
);

const sources = (over: Partial<ScenarioSourcesInput> = {}): ScenarioSourcesInput => ({
    documentIds: [7],
    searchFiles: false,
    prospects: false,
    brandComments: false,
    companyProfile: false,
    notes: "",
    ...over,
});

beforeEach(() => {
    jest.clearAllMocks();
    getWorkspaceEndpointRow.mockResolvedValue(null);
});

describe("a new run's context mode", () => {
    const healthy = { health: jest.fn(async () => ({ ok: true })) };

    it("is graph when the service is configured and answering", async () => {
        scenarioGraphPort.mockReturnValue(healthy);
        expect(await resolveContextMode(5n, "graph", sources())).toEqual({
            mode: "graph",
            fallbackReason: null,
        });
    });

    it.each([
        ["graph_not_configured", () => scenarioGraphPort.mockReturnValue(null), sources()],
        [
            "no_documents",
            () => scenarioGraphPort.mockReturnValue(healthy),
            sources({ documentIds: [] }),
        ],
        [
            "workspace_endpoint",
            () => {
                scenarioGraphPort.mockReturnValue(healthy);
                getWorkspaceEndpointRow.mockResolvedValue({ models: { default: { id: "m" } } });
            },
            sources(),
        ],
        [
            "graph_unavailable",
            () =>
                scenarioGraphPort.mockReturnValue({
                    health: jest.fn(async () => ({ ok: false })),
                }),
            sources(),
        ],
        [
            "graph_unavailable",
            () =>
                scenarioGraphPort.mockReturnValue({
                    health: jest.fn(async () => {
                        throw new Error("connect ECONNREFUSED 127.0.0.1:8711");
                    }),
                }),
            sources(),
        ],
    ] as const)("falls back to passage, recording %s", async (reason, arrange, input) => {
        arrange();
        expect(await resolveContextMode(5n, "graph", input)).toEqual({
            mode: "passage",
            fallbackReason: reason,
        });
    });

    it("keeps an explicit passage or facts request as asked, without asking the service", async () => {
        scenarioGraphPort.mockReturnValue(healthy);
        for (const mode of ["passage", "facts"] as const) {
            expect(await resolveContextMode(5n, mode, sources())).toEqual({
                mode,
                fallbackReason: null,
            });
        }
        expect(healthy.health).not.toHaveBeenCalled();
    });
});

describe("reading a v2 run's derived artifacts", () => {
    const run = {
        id: 11,
        companyId: 5n,
        contractVersion: 2,
        createdByUserId: "creator",
        sharedAt: new Date("2026-11-13T09:00:00Z"),
        status: "done",
        generation: 1,
        roundCount: 2,
        sources: sources({ documentIds: [7, 8] }),
        flags: null,
    } as unknown as ScenarioRunRecord;
    // The manifest, not the request, says what the run read: file 9 came in
    // through a workspace search.
    const manifest = { documentIds: [7, 8, 9] };

    const readers = {
        "the creator after losing access to one file": makeWorkspaceContext({
            authUserId: "creator",
        }),
        "a reader of the shared run who cannot open one file": makeWorkspaceContext({
            authUserId: "reader",
        }),
    };

    it.each(Object.entries(readers))(
        "tells %s that the run does not exist, naming nothing",
        async (_who, ctx) => {
            getCompanyRun.mockResolvedValue(run);
            readManifest.mockResolvedValue(manifest);
            visibleDocumentIds.mockResolvedValue(new Set([7, 8]));

            for (const read of [
                () => getScenarioProvenance(ctx, 11, { after: null, limit: null }, "en"),
                () => getScenarioTrace(ctx, 11, { afterSeq: null, limit: null }),
                () => replayScenario(ctx, 11),
            ]) {
                const error = (await read().catch((e: unknown) => e)) as {
                    status: number;
                    code: string;
                    message: string;
                };
                expect(error).toMatchObject({ status: 404, code: "not_found" });
                expect(error.message).toBe("copy:notFound");
            }
            // Checked against the manifest's files, the hidden one included.
            expect(visibleDocumentIds).toHaveBeenCalledWith(5n, expect.anything(), [7, 8, 9]);
        }
    );

    it("lets a reader who can open every file through", async () => {
        getCompanyRun.mockResolvedValue(run);
        readManifest.mockResolvedValue(manifest);
        visibleDocumentIds.mockResolvedValue(new Set([7, 8, 9]));
        const ctx = makeWorkspaceContext({ authUserId: "reader" });
        await expect(replayScenario(ctx, 11)).resolves.toMatchObject({ available: false });
    });

    it("treats an unshared run as missing for anyone but its creator", async () => {
        getCompanyRun.mockResolvedValue({ ...run, sharedAt: null });
        readManifest.mockResolvedValue(manifest);
        visibleDocumentIds.mockResolvedValue(new Set([7, 8, 9]));
        const ctx = makeWorkspaceContext({ authUserId: "reader" });
        await expect(replayScenario(ctx, 11)).rejects.toMatchObject({ status: 404 });
        expect(visibleDocumentIds).not.toHaveBeenCalled();
    });
});
