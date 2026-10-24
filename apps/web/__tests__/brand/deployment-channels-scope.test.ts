/**
 * listBrandChannels is what compose validates against and what the Accounts
 * screen shows: the deployment's channels appear only in the workspace that
 * owns them. On a shared server a workspace sees its own channels alone.
 */
jest.mock("~/env", () => ({ env: { server: {}, client: {} } }));
jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("~/server/services/connectors/config", () => ({}));
jest.mock("~/server/public-origin", () => ({ configuredPublicOrigin: () => null }));
jest.mock("@launchstack/pipelines/marketing/posts", () => ({ platformLimit: () => 3000 }));
jest.mock("@launchstack/tools/social-publish", () => ({}));

const mockListChannelRows = jest.fn();
const mockDeploymentChannels = jest.fn();
jest.mock("~/server/brand/channels", () => ({
    NETWORK_LABELS: {},
    connectionProblem: () => null,
    listChannelRows: (...a: unknown[]) => mockListChannelRows(...a),
    deploymentChannels: (...a: unknown[]) => mockDeploymentChannels(...a),
    toChannelView: (row: { id: string; platform: string }) => ({
        id: row.id,
        platform: row.platform,
    }),
}));

const mockMay = jest.fn();
jest.mock("~/server/brand/deployment-accounts", () => ({
    mayUseDeploymentAccounts: (...a: unknown[]) => mockMay(...a),
}));

import { listBrandChannels } from "~/server/brand/accounts";

const OWN = { id: "ch-bsky", platform: "bluesky", connectionId: 3 };
const DEPLOY_X = { id: "deployment:x", platform: "x", kind: "deployment" };

beforeEach(() => {
    jest.clearAllMocks();
    mockListChannelRows.mockResolvedValue([OWN]);
    mockDeploymentChannels.mockReturnValue([DEPLOY_X]);
});

it("the owning workspace gets its own channels and the deployment's", async () => {
    mockMay.mockResolvedValue(true);
    const ids = (await listBrandChannels(BigInt(1), [])).map(c => c.id);
    expect(ids).toEqual(["ch-bsky", "deployment:x"]);
});

it("any other workspace gets only its own: the shared X account is not offered", async () => {
    mockMay.mockResolvedValue(false);
    const ids = (await listBrandChannels(BigInt(2), [])).map(c => c.id);
    expect(ids).toEqual(["ch-bsky"]);
    expect(mockDeploymentChannels).not.toHaveBeenCalled();
    expect(mockMay).toHaveBeenCalledWith(BigInt(2));
});
