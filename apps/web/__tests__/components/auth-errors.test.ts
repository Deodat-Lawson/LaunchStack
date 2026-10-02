import {
    NETWORK_ERROR,
    oauthErrorMessage,
    parseRetryAfter,
    rateLimitMessage,
    signInFailureMessage,
} from "~/components/auth/auth-errors";

describe("signInFailureMessage", () => {
    it("reads a wrong password and an unknown email the same", () => {
        // better-auth answers 401 for both; the sentence must not tell them apart.
        const message = signInFailureMessage({ status: 401, message: "Invalid email or password" });
        expect(message).toBe("That email and password don't match. Check both and try again.");
        expect(signInFailureMessage({ status: 400 })).toBe(message);
    });

    it("tells a dropped connection apart from a refusal", () => {
        expect(signInFailureMessage({ status: 0 })).toBe(NETWORK_ERROR);
    });

    it("names the wait when the rate limiter gave one", () => {
        expect(signInFailureMessage({ status: 429, retryAfter: 7 })).toBe(
            "Too many attempts. Try again in 7 seconds."
        );
        expect(rateLimitMessage(1)).toBe("Too many attempts. Try again in 1 second.");
        expect(rateLimitMessage(null)).toBe("Too many attempts. Wait a moment, then try again.");
    });

    it("passes other server messages through, with a fallback", () => {
        expect(signInFailureMessage({ status: 403, message: "Email not verified" })).toBe(
            "Email not verified"
        );
        expect(signInFailureMessage({ status: 500 })).toBe(
            "Sign-in failed. Try again in a moment."
        );
    });
});

describe("parseRetryAfter", () => {
    it("accepts positive seconds and rounds up", () => {
        expect(parseRetryAfter("9")).toBe(9);
        expect(parseRetryAfter("2.1")).toBe(3);
    });

    it("ignores missing, zero, and junk values", () => {
        expect(parseRetryAfter(null)).toBeNull();
        expect(parseRetryAfter("0")).toBeNull();
        expect(parseRetryAfter("soon")).toBeNull();
    });
});

describe("oauthErrorMessage", () => {
    it("is null without a code", () => {
        expect(oauthErrorMessage(null)).toBeNull();
        expect(oauthErrorMessage("")).toBeNull();
    });

    it("explains a cancelled consent screen", () => {
        expect(oauthErrorMessage("access_denied", "google")).toMatch(/cancelled/);
    });

    it("points a password account back at its password", () => {
        expect(oauthErrorMessage("account_not_linked", "github")).toMatch(
            /email and password instead/
        );
    });

    it("names the provider when it withheld the email", () => {
        expect(oauthErrorMessage("email_not_found", "github")).toMatch(/^GitHub didn't share/);
        expect(oauthErrorMessage("email_not_found")).toMatch(/^The provider didn't share/);
    });

    it("treats lost or replayed state as an expired attempt", () => {
        for (const code of ["state_not_found", "state_mismatch", "please_restart_the_process"]) {
            expect(oauthErrorMessage(code)).toBe("That sign-in attempt expired. Please try again.");
        }
    });

    it("never shows a raw code it doesn't know", () => {
        const message = oauthErrorMessage("some_new_internal_code");
        expect(message).not.toContain("some_new_internal_code");
        expect(message).toMatch(/couldn't complete that sign-in/);
    });
});
