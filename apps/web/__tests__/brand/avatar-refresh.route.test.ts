import type * as MockRequireWorkspaceContext from "../helpers/mock-require-workspace-context";
import { makeWorkspaceContext } from "../helpers/workspace-context";
import { POST } from "~/app/api/brand/connections/[id]/refresh/route";

const mockRequireWorkspaceContext = jest.fn();
const mockProfile = jest.fn();
const mockSelect = jest.fn();
const mockSet = jest.fn();

jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);
jest.mock("@launchstack/tools/social-publish/bluesky", () => ({
    getBlueskyProfile: (...args: unknown[]) => mockProfile(...args),
}));
jest.mock("~/server/brand/accounts", () => ({
    listBrandAccounts: jest.fn().mockResolvedValue({ channels: [] }),
}));
jest.mock("~/server/brand/channels", () => ({
    ChannelUnavailableError: class extends Error {},
    channelsForConnections: jest.fn().mockResolvedValue([{ id: "c1" }]),
    discoverLinkedInChannels: jest.fn(),
}));
jest.mock("~/server/services/connectors/connection-store", () => ({
    getConnectionById: jest.fn().mockResolvedValue({
        id: 1,
        companyId: 7n,
        provider: "bluesky",
        providerAccountId: "did:plc:1",
    }),
}));
jest.mock("~/server/db", () => ({
    db: {
        select: (...args: unknown[]) => mockSelect(...args),
        update: () => ({ set: (...args: unknown[]) => mockSet(...args) }),
    },
}));
jest.mock("~/env", () => ({
    env: { server: { NEXT_PUBLIC_S3_ENDPOINT: "https://s3.example", S3_BUCKET_NAME: "files" } },
}));

const CANONICAL = "https://s3.example/files/avatars/owned.png";

beforeEach(() => {
    jest.clearAllMocks();
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ companyId: 7n, role: "owner" }),
    });
    mockSelect.mockReturnValue({
        from: () => ({
            where: () => Promise.resolve([{ companyId: 7n, url: CANONICAL, deletedAt: null }]),
        }),
    });
    mockSet.mockReturnValue({ where: () => Promise.resolve() });
});

it.each([
    ["a noncanonical alias", "https://s3.example/files/avatars/%6fwned.png", 404],
    ["the owned canonical URL", CANONICAL, 200],
    ["an external provider location", "https://another.ufs.sh/f/avatar", 200],
])("brand profile refresh handles %s", async (_label, avatarUrl, expectedStatus) => {
    mockProfile.mockResolvedValue({ handle: "test.bsky.social", avatarUrl });
    const response = await POST(
        new Request("https://app.test/api/brand/connections/1/refresh", {
            method: "POST",
        }) as Parameters<typeof POST>[0],
        { params: Promise.resolve({ id: "1" }) }
    );
    expect(response.status).toBe(expectedStatus);
    if (expectedStatus === 404) {
        expect(await response.json()).toEqual({ error: expect.any(String) });
        expect(mockSet).not.toHaveBeenCalled();
    } else {
        expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ avatarUrl }));
    }
});

it.each([
    "/api/files/unused/../7",
    "/api/./files/7",
    "\\api\\files\\7",
    " \t/api/fi\tles/7 \t",
    "/api/files/9/../../../api/files/7",
])("brand refresh persists the canonical database avatar for %j", async avatarUrl => {
    mockProfile.mockResolvedValue({ handle: "test.bsky.social", avatarUrl });

    const response = await POST(
        new Request("https://app.test/api/brand/connections/1/refresh", {
            method: "POST",
        }) as Parameters<typeof POST>[0],
        { params: Promise.resolve({ id: "1" }) }
    );

    expect(response.status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ avatarUrl: "/api/files/7" }));
});
