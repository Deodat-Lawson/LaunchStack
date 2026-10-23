/**
 * drive.readonly is a restricted scope: until Google verifies the app, asking
 * for it puts an "unverified app" warning on the consent screen. So a plain
 * Drive connect never asks for it; only "Allow folder access"
 * (`?access=folders`) does, and only where the operator allows folder import.
 * The callback records what was granted, even when Google's token response
 * leaves `scope` out.
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
    requireWorkspaceContext: jest.fn(),
    requireWorkspacePermission: jest.fn(),
}));
jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("~/server/engine", () => ({ getEngine: jest.fn() }));
jest.mock("~/server/inngest/client", () => ({ inngest: { send: jest.fn() } }));
jest.mock("~/lib/authz/audit", () => ({ recordAuditEvent: jest.fn() }));
jest.mock("~/server/services/google-drive/connections", () => ({
    upsertGoogleConnection: jest.fn(),
}));
jest.mock("~/server/services/connectors/google-drive/store", () => ({
    ensureSyncState: jest.fn(),
    listPickedItems: jest.fn().mockResolvedValue([]),
    resetSyncCursor: jest.fn(),
}));
jest.mock("@launchstack/google-drive", () => ({
    ...jest.requireActual("@launchstack/google-drive"),
    exchangeAuthorizationCode: jest.fn(),
    decodeIdTokenClaims: () => ({ sub: "google-1", email: "alex.rivera@example.com" }),
}));

import { exchangeAuthorizationCode } from "@launchstack/google-drive";

import { GET as callback } from "~/app/api/connectors/google/oauth/callback/route";
import { GET as start } from "~/app/api/connectors/google/oauth/start/route";
import {
    requireWorkspaceContext,
    requireWorkspacePermission,
} from "~/lib/require-workspace-context";
import {
    DRIVE_FILE_SCOPE,
    DRIVE_READONLY_SCOPE,
    GOOGLE_OAUTH_STATE_COOKIE,
} from "~/server/services/google-drive/config";
import { upsertGoogleConnection } from "~/server/services/google-drive/connections";

import { makeWorkspaceContext } from "../helpers/workspace-context";

const ORIGIN = "https://app.example.com";

async function requestedScopes(query: string): Promise<string[]> {
    const consent = await start(new Request(`${ORIGIN}/api/connectors/google/oauth/start${query}`));
    expect(consent.status).toBe(307);
    const authorize = new URL(consent.headers.get("location") ?? "");
    return (authorize.searchParams.get("scope") ?? "").split(" ");
}

/** Consent, then come back from Google with a token response that has no `scope`. */
async function grantWithoutScope(query: string): Promise<string> {
    const consent = await start(new Request(`${ORIGIN}/api/connectors/google/oauth/start${query}`));
    const state = new URL(consent.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const nonce = /gdrive_oauth_state=([^;]+)/.exec(consent.headers.get("set-cookie") ?? "")?.[1];
    const back = await callback(
        new Request(`${ORIGIN}/api/connectors/google/oauth/callback?code=c&state=${state}`, {
            headers: { cookie: `${GOOGLE_OAUTH_STATE_COOKIE}=${nonce}` },
        })
    );
    expect(back.headers.get("location")).toContain("result=connected");
    const [input] = (upsertGoogleConnection as jest.Mock).mock.calls.at(-1) as [{ scopes: string }];
    return input.scopes;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockServerEnv.GOOGLE_DRIVE_FOLDER_ACCESS_ENABLED = "true";
    const ctx = { success: true, data: makeWorkspaceContext({ role: "admin" }) };
    (requireWorkspacePermission as jest.Mock).mockResolvedValue(ctx);
    (requireWorkspaceContext as jest.Mock).mockResolvedValue(ctx);
    (exchangeAuthorizationCode as jest.Mock).mockResolvedValue({
        access_token: "a",
        refresh_token: "r",
        id_token: "id",
        expires_in: 3600,
    });
    (upsertGoogleConnection as jest.Mock).mockResolvedValue({ id: 7 });
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

describe("when Google's token response leaves scope out", () => {
    it("records folder access for an Allow folder access grant", async () => {
        expect((await grantWithoutScope("?access=folders")).split(" ")).toContain(
            DRIVE_READONLY_SCOPE
        );
    });

    it("records drive.file alone for a plain connect", async () => {
        const scopes = (await grantWithoutScope("")).split(" ");
        expect(scopes).toContain(DRIVE_FILE_SCOPE);
        expect(scopes).not.toContain(DRIVE_READONLY_SCOPE);
    });
});
