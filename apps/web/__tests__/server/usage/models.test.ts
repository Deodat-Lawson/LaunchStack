/**
 * Models & usage › Models › Usage by model. The workspace's own models are
 * named the way its admins set them up (offered name, routes, id); the
 * server's are one row per route and never carry a model id.
 */

jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("~/server/workspace-models/store", () => ({ getWorkspaceEndpointRow: jest.fn() }));

import { modelUsageRows, type ModelUsageRaw } from "~/server/usage/models";
import type { WorkspaceModelSelection } from "~/server/db/schema/workspace-models";

const raw = (overrides: Partial<ModelUsageRaw>): ModelUsageRaw => ({
    owner: "workspace",
    route: "default",
    modelId: "acme/main",
    calls: 1,
    inputTokens: 100,
    outputTokens: 50,
    weightedTokens: 150,
    pricedCalls: 0,
    costUsd: 0,
    ...overrides,
});

const selection: WorkspaceModelSelection = {
    default: { id: "acme/main", vision: false, reasoning: false },
    fast: { id: "acme/quick", vision: false, reasoning: false },
    offered: [
        {
            key: "a1b2c3d4",
            label: "Team writer",
            id: "acme/writer",
            vision: false,
            reasoning: true,
        },
    ],
};

describe("modelUsageRows", () => {
    it("names the workspace's models by what they are now, busiest first", () => {
        const rows = modelUsageRows(
            [
                raw({ modelId: "acme/main", calls: 2, weightedTokens: 300 }),
                raw({ modelId: "acme/main", route: "fast", calls: 1, weightedTokens: 100 }),
                raw({
                    modelId: "acme/writer",
                    calls: 5,
                    weightedTokens: 900,
                    pricedCalls: 5,
                    costUsd: 0.25,
                }),
                raw({ modelId: "acme/old", calls: 1, weightedTokens: 10 }),
            ],
            selection
        );
        expect(rows.map(row => [row.modelId, row.label, row.routes, row.retired])).toEqual([
            ["acme/writer", "Team writer", [], false],
            ["acme/main", undefined, ["default"], false],
            ["acme/old", undefined, [], true],
        ]);
        expect(rows[0]).toMatchObject({ key: "a1b2c3d4", calls: 5, aiTokens: 900, costUsd: 0.25 });
        // The two routes' rows for the main model add up.
        expect(rows[1]).toMatchObject({ calls: 3, aiTokens: 400, costUsd: null });
    });

    it("gives the server's models one row per route, after the workspace's, with no id", () => {
        const rows = modelUsageRows(
            [
                raw({ owner: "deployment", route: "fast", modelId: "" }),
                raw({ owner: "deployment", route: "default", modelId: "", calls: 4 }),
                raw({ owner: "workspace", modelId: "acme/main" }),
            ],
            selection
        );
        expect(rows.map(row => [row.kind, row.route ?? row.modelId])).toEqual([
            ["workspace", "acme/main"],
            ["server", "default"],
            ["server", "fast"],
        ]);
        for (const row of rows.filter(row => row.kind === "server")) {
            expect(row).not.toHaveProperty("modelId");
            expect(row).not.toHaveProperty("label");
        }
    });

    it("works with no setup at all (a workspace on the server's models)", () => {
        const rows = modelUsageRows([raw({ owner: "deployment", modelId: "" })], null);
        expect(rows).toEqual([
            expect.objectContaining({ kind: "server", route: "default", calls: 1, costUsd: null }),
        ]);
    });
});
