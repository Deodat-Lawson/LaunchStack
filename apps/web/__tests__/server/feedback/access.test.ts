/**
 * Who triages feedback, from FEEDBACK_ADMIN_EMAILS — and the rule that an
 * instance naming nobody has the feature off.
 */

jest.mock("server-only", () => ({}), { virtual: true });

import {
    feedbackAccessFor,
    feedbackAdminEmails,
    feedbackEnabled,
    isFeedbackTriager,
    parseFeedbackAdminEmails,
} from "~/server/feedback/access";

const ORIGINAL = process.env.FEEDBACK_ADMIN_EMAILS;

afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.FEEDBACK_ADMIN_EMAILS;
    else process.env.FEEDBACK_ADMIN_EMAILS = ORIGINAL;
});

describe("parseFeedbackAdminEmails", () => {
    it("splits on commas, spaces, semicolons and newlines, lower-casing each", () => {
        expect([
            ...parseFeedbackAdminEmails(
                " Ops@Example.com,founder@example.com; qa@example.com\nx@y.io "
            ),
        ]).toEqual(["ops@example.com", "founder@example.com", "qa@example.com", "x@y.io"]);
    });

    it("ignores empty entries and entries that are not addresses", () => {
        expect([...parseFeedbackAdminEmails(",, ;  admin  ; ops@example.com,")]).toEqual([
            "ops@example.com",
        ]);
        expect(parseFeedbackAdminEmails(undefined).size).toBe(0);
        expect(parseFeedbackAdminEmails("").size).toBe(0);
    });
});

describe("feedback access", () => {
    it("is off, for everyone, while nobody is named", () => {
        delete process.env.FEEDBACK_ADMIN_EMAILS;
        expect(feedbackEnabled()).toBe(false);
        expect(feedbackAccessFor("ops@example.com")).toEqual({ enabled: false, triager: false });

        process.env.FEEDBACK_ADMIN_EMAILS = "   ";
        expect(feedbackEnabled()).toBe(false);
        expect(feedbackAdminEmails().size).toBe(0);
    });

    it("is on once someone is named, and only they triage (case-insensitive)", () => {
        process.env.FEEDBACK_ADMIN_EMAILS = "Ops@Example.com";
        expect(feedbackEnabled()).toBe(true);
        expect(isFeedbackTriager("ops@example.com")).toBe(true);
        expect(isFeedbackTriager("  OPS@EXAMPLE.COM ")).toBe(true);
        expect(isFeedbackTriager("someone@example.com")).toBe(false);
        expect(isFeedbackTriager("")).toBe(false);
        expect(isFeedbackTriager(null)).toBe(false);
        expect(feedbackAccessFor("ops@example.com")).toEqual({ enabled: true, triager: true });
        expect(feedbackAccessFor("someone@example.com")).toEqual({
            enabled: true,
            triager: false,
        });
        expect(feedbackAccessFor(undefined)).toEqual({ enabled: true, triager: false });
    });

    it("reads the variable on every call, so a changed list applies without a rebuild", () => {
        process.env.FEEDBACK_ADMIN_EMAILS = "a@example.com";
        expect(isFeedbackTriager("b@example.com")).toBe(false);
        process.env.FEEDBACK_ADMIN_EMAILS = "a@example.com b@example.com";
        expect(isFeedbackTriager("b@example.com")).toBe(true);
    });
});
