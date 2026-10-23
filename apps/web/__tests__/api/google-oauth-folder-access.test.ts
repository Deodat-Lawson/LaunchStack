/**
 * drive.readonly is a restricted scope: until Google verifies the app, asking
 * for it puts an "unverified app" warning on the consent screen. So a plain
 * Drive connect never asks for it; only "Allow folder access"
 * (`?access=folders`) does, and only where the operator allows folder import.
 */
const mockServerEnv = {
    GOOGLE_OAUTH_CLIENT_ID: "cid",
    GOOGLE_OAUTH_CLIENT_SECRET: "sec",
    GOOGLE_OAUTH_REDIRECT_URL: undefined as string | undefined,
    GOOGLE_DRIVE_FOLDER_ACCESS_ENABLED: "true" as string | undefined,
};
jest.mock("~/env", () => ({
    get env() {
        return { server: mockServerEnv, client: {} };
    },
}));
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspacePermission: jest.fn(),
}));

import { GET as start } from "~/app/api/connectors/google/oauth/start/route";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { DRIVE_FILE_SCOPE, DRIVE_READONLY_SCOPE } from "~/server/services/google-drive/config";

import { makeWorkspaceContext } from "../helpers/workspace-context";

const ORIGIN = "https://app.example.com";

async function requestedScopes(query: string): Promise<string[]> {
    const consent = await start(new Request(`${ORIGIN}/api/connectors/google/oauth/start${query}`));
    expect(consent.status).toBe(307);
    const authorize = new URL(consent.headers.get("location") ?? "");
    return (authorize.searchParams.get("scope") ?? "").split(" ");
}

beforeEach(() => {
    mockServerEnv.GOOGLE_DRIVE_FOLDER_ACCESS_ENABLED = "true";
    (requireWorkspacePermission as jest.Mock).mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ role: "admin" }),
    });
});

it("connects with drive.file alone, even where folder import is on", async () => {
    const scopes = await requestedScopes("");
    expect(scopes).toContain(DRIVE_FILE_SCOPE);
    expect(scopes).not.toContain(DRIVE_READONLY_SCOPE);
});

it("adds drive.readonly when someone allows folder access", async () => {
    expect(await requestedScopes("?access=folders")).toEqual([
        DRIVE_FILE_SCOPE,
        DRIVE_READONLY_SCOPE,
        "openid",
        "email",
    ]);
});

it("never asks for drive.readonly where the operator hasn't allowed folder import", async () => {
    mockServerEnv.GOOGLE_DRIVE_FOLDER_ACCESS_ENABLED = undefined;
    expect(await requestedScopes("?access=folders")).not.toContain(DRIVE_READONLY_SCOPE);
});
