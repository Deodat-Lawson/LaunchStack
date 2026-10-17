import {
    connectErrorMessage,
    NETWORK_ERROR,
    oauthErrorMessage,
    parseRetryAfter,
    rateLimitMessage,
    signInFailureMessage,
} from "~/components/auth/auth-errors";
import { formatTakeoverNotice, parseTakeoverNotice } from "~/lib/auth/takeover-notice";

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

    it("blames an unconfirmed address, not an existing password", () => {
        // A provider that confirms the address now links to the account (see
        // ~/server/auth/account-linking); only one that hasn't is refused.
        const message = oauthErrorMessage("account_not_linked", "github");
        expect(message).toMatch(/^GitHub hasn't confirmed you own this email address/);
        expect(message).not.toMatch(/password/);
        expect(oauthErrorMessage("account_not_linked")).toMatch(/^That provider hasn't confirmed/);
        expect(oauthErrorMessage("unable_to_link_account", "google")).toMatch(
            /^We couldn't connect Google/
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

describe("connectErrorMessage", () => {
    it("names the address a mismatched account should have", () => {
        expect(connectErrorMessage("email_does_not_match", "google", "ana@example.com")).toBe(
            "That Google account uses a different email address. Connect the Google account for ana@example.com."
        );
        expect(connectErrorMessage("email_does_not_match", "google")).toMatch(
            /different email address from this one/
        );
    });

    it("explains an account that already belongs to someone else", () => {
        expect(connectErrorMessage("account_already_linked_to_different_user", "github")).toBe(
            "That GitHub account already signs in to a different Launchstack account."
        );
    });

    it("never shows a raw code it doesn't know", () => {
        const message = connectErrorMessage("some_new_internal_code", "google");
        expect(message).not.toContain("some_new_internal_code");
        expect(message).toBe("We couldn't connect Google. Try again in a moment.");
    });
});

describe("parseTakeoverNotice", () => {
    it("reads the provider and what it replaced", () => {
        expect(parseTakeoverNotice("google:credential")).toEqual({
            provider: "Google",
            removed: "the password",
            plural: false,
            passwordRemoved: true,
        });
        expect(parseTakeoverNotice("google%3Acredential%2Bgithub")).toEqual({
            provider: "Google",
            removed: "the password and GitHub sign-in",
            plural: true,
            passwordRemoved: true,
        });
        expect(parseTakeoverNotice("google:github")).toMatchObject({ passwordRemoved: false });
    });

    it("reads back what the server writes", () => {
        expect(parseTakeoverNotice(formatTakeoverNotice("github", ["credential"]))).toMatchObject({
            provider: "GitHub",
            removed: "the password",
        });
    });

    it("shows nothing for a missing, malformed or unknown value", () => {
        for (const raw of [
            null,
            "",
            "google",
            "google:",
            "nope:credential",
            "google:nope",
            "%E0",
        ]) {
            expect(parseTakeoverNotice(raw)).toBeNull();
        }
    });
});
