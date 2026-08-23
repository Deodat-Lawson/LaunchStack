import { randomBytes } from "node:crypto";

import {
    createZoomOAuthState,
    decryptZoomSecret,
    encryptZoomSecret,
    verifyZoomOAuthState,
} from "~/server/call-notes/zoom-oauth";

const key = randomBytes(32).toString("base64");

describe("Zoom OAuth security", () => {
    it("encrypts tokens with purpose-bound authenticated encryption", () => {
        const encrypted = encryptZoomSecret("access-token", key, "zoom-access-token");

        expect(encrypted).not.toContain("access-token");
        expect(decryptZoomSecret(encrypted, key, "zoom-access-token")).toBe("access-token");
        expect(() => decryptZoomSecret(encrypted, key, "zoom-refresh-token")).toThrow();
    });

    it("binds OAuth state to its cookie and authenticated user context", () => {
        const state = createZoomOAuthState("user-1", "42", key, 1_000);

        expect(
            verifyZoomOAuthState({
                queryState: state,
                cookieState: state,
                keyBase64: key,
                now: 2_000,
            })
        ).toEqual({ userId: "user-1", companyId: "42", expiresAt: 601_000 });
        expect(() =>
            verifyZoomOAuthState({
                queryState: state,
                cookieState: `${state}x`,
                keyBase64: key,
                now: 2_000,
            })
        ).toThrow("Zoom OAuth state mismatch");
    });

    it("rejects expired state without a network fallback", () => {
        const state = createZoomOAuthState("user-1", "42", key, 1_000);
        expect(() =>
            verifyZoomOAuthState({
                queryState: state,
                cookieState: state,
                keyBase64: key,
                now: 602_000,
            })
        ).toThrow("Zoom OAuth state is invalid or expired");
    });
});
