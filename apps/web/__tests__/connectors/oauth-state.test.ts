/**
 * The HMAC-signed OAuth state: round-trip, tamper rejection, TTL expiry,
 * provider validation, and the key requirement. The signing key derives from
 * EMBEDDING_SECRETS_KEY, so the module must refuse to run without one.
 */

import { randomBytes } from "node:crypto";

const mockEnv = {
    server: { EMBEDDING_SECRETS_KEY: randomBytes(32).toString("base64") as string | undefined },
};
jest.mock("~/env", () => ({
    get env() {
        return mockEnv;
    },
}));

import {
    OAUTH_STATE_TTL_MS,
    oauthNonceCookieName,
    signState,
    verifyState,
} from "~/server/services/connectors/oauth-state";

const PAYLOAD = {
    provider: "slack" as const,
    companyId: "42",
    userPk: 7,
    nonce: "nonce-1",
    iat: Date.now(),
};

describe("oauth state", () => {
    it("round-trips a signed payload", () => {
        expect(verifyState(signState(PAYLOAD))).toEqual(PAYLOAD);
    });

    it("rejects a tampered payload", () => {
        const state = signState(PAYLOAD);
        const [encoded, mac] = state.split(".");
        const forged = Buffer.from(
            JSON.stringify({ ...PAYLOAD, companyId: "999" }),
            "utf8"
        ).toString("base64url");

        expect(verifyState(`${forged}.${mac}`)).toBeNull();
        expect(verifyState(`${encoded}.AAAA${mac}`)).toBeNull();
        expect(verifyState("garbage")).toBeNull();
    });

    it("rejects a provider outside the generic layer even when correctly signed", () => {
        const state = signState({
            ...PAYLOAD,
            provider: "google-drive" as unknown as typeof PAYLOAD.provider,
        });
        expect(verifyState(state)).toBeNull();
    });

    it("rejects an expired state", () => {
        const state = signState(PAYLOAD);
        expect(verifyState(state, PAYLOAD.iat + OAUTH_STATE_TTL_MS + 1)).toBeNull();
        expect(verifyState(state, PAYLOAD.iat + OAUTH_STATE_TTL_MS - 1)).not.toBeNull();
    });

    it("refuses to sign without the master key", () => {
        const key = mockEnv.server.EMBEDDING_SECRETS_KEY;
        mockEnv.server.EMBEDDING_SECRETS_KEY = undefined;
        try {
            expect(() => signState(PAYLOAD)).toThrow("EMBEDDING_SECRETS_KEY");
        } finally {
            mockEnv.server.EMBEDDING_SECRETS_KEY = key;
        }
    });

    it("scopes the nonce cookie per provider", () => {
        expect(oauthNonceCookieName("github")).toBe("connector_oauth_nonce_github");
        expect(oauthNonceCookieName("github")).not.toBe(oauthNonceCookieName("slack"));
    });
});
