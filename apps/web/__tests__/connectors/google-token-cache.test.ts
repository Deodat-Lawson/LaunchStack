/**
 * The access-token cache must not outlive the grant it came from. The web app
 * and the worker are separate processes: a reconnect in the web app (say, one
 * that added drive.readonly) stores a new refresh token, and the worker's next
 * sync has to mint from it rather than keep a token from the old grant.
 */

const mockEnv = {
    server: {
        GOOGLE_OAUTH_CLIENT_ID: "cid" as string | undefined,
        GOOGLE_OAUTH_CLIENT_SECRET: "sec" as string | undefined,
        GOOGLE_STAND_IN_URL: undefined as string | undefined,
    },
};
jest.mock("~/env", () => ({
    get env() {
        return mockEnv;
    },
}));
jest.mock("~/server/engine", () => ({ getEngine: jest.fn() }));
jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("@launchstack/store/crypto", () => ({
    decryptSecret: (ciphertext: string) => `refresh-for-${ciphertext}`,
    encryptSecret: jest.fn(),
}));
jest.mock("@launchstack/google-drive", () => ({
    ...jest.requireActual("@launchstack/google-drive"),
    refreshAccessToken: jest.fn(),
}));

import { refreshAccessToken } from "@launchstack/google-drive";

import type { ConnectorConnection } from "~/server/db/schema";
import {
    clearAccessTokenCache,
    getAccessTokenForConnection,
} from "~/server/services/google-drive/connections";

function connection(ciphertext: string): ConnectorConnection {
    return { id: 26, refreshTokenCiphertext: ciphertext } as unknown as ConnectorConnection;
}

beforeEach(() => {
    clearAccessTokenCache();
    jest.mocked(refreshAccessToken).mockReset();
    let n = 0;
    jest.mocked(refreshAccessToken).mockImplementation(async ({ refreshToken }) => {
        n += 1;
        return { access_token: `${refreshToken}#${n}`, expires_in: 3600 };
    });
});

it("reuses a token while the grant is unchanged", async () => {
    expect(await getAccessTokenForConnection(connection("grant-a"))).toBe("refresh-for-grant-a#1");
    expect(await getAccessTokenForConnection(connection("grant-a"))).toBe("refresh-for-grant-a#1");
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
});

it("mints a new token as soon as the stored grant changes", async () => {
    await getAccessTokenForConnection(connection("grant-a"));
    expect(await getAccessTokenForConnection(connection("grant-b"))).toBe("refresh-for-grant-b#2");
    expect(refreshAccessToken).toHaveBeenCalledTimes(2);
});
