/**
 * The signed `requestState` a form round trip carries: it binds the tool, the
 * person, the workspace and the call's arguments, expires, and fails closed on
 * any change.
 */
import {
    REQUEST_STATE_TTL_MS,
    argumentsDigest,
    canonicalJson,
    signRequestState,
    verifyRequestState,
} from "~/server/mcp/request-state";

const previousSecret = process.env.BETTER_AUTH_SECRET;
beforeAll(() => {
    process.env.BETTER_AUTH_SECRET = "test-secret-for-request-state";
});
afterAll(() => {
    process.env.BETTER_AUTH_SECRET = previousSecret;
});

const binding = {
    tool: "add_document",
    authUserId: "user-a",
    companyId: BigInt(5),
    argumentsDigest: argumentsDigest({ content: "# Plan", format: "markdown" }),
};

describe("canonicalJson / argumentsDigest", () => {
    it("ignores key order and undefined values, at every depth", () => {
        expect(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: undefined } })).toBe(
            '{"a":{"d":[1,{"x":1,"y":2}]},"b":1}'
        );
        expect(argumentsDigest({ a: 1, b: 2 })).toBe(argumentsDigest({ b: 2, a: 1 }));
        expect(argumentsDigest({ a: 1 })).not.toBe(argumentsDigest({ a: 2 }));
    });
});

describe("signRequestState / verifyRequestState", () => {
    it("round-trips the tool's data for the same binding", () => {
        const state = signRequestState(binding, { stagedId: "draft_abc", stage: "destination" });
        expect(verifyRequestState(state, binding)).toEqual({
            ok: true,
            data: { stagedId: "draft_abc", stage: "destination" },
        });
    });

    it("fails for another person, workspace, tool or argument set", () => {
        const state = signRequestState(binding, { stagedId: "draft_abc" });
        for (const other of [
            { ...binding, authUserId: "user-b" },
            { ...binding, companyId: BigInt(6) },
            { ...binding, tool: "save_conversation" },
            { ...binding, argumentsDigest: argumentsDigest({ content: "other" }) },
        ]) {
            expect(verifyRequestState(state, other)).toEqual({ ok: false, reason: "mismatch" });
        }
    });

    it("fails once it expires", () => {
        const now = Date.now();
        const state = signRequestState(binding, {}, now);
        expect(verifyRequestState(state, binding, now + REQUEST_STATE_TTL_MS - 1).ok).toBe(true);
        expect(verifyRequestState(state, binding, now + REQUEST_STATE_TTL_MS + 1)).toEqual({
            ok: false,
            reason: "expired",
        });
    });

    it("fails when any byte of the body or signature is changed", () => {
        const state = signRequestState(binding, { stagedId: "draft_abc" });
        const [body, sig] = state.split(".") as [string, string];
        const forgedBody = Buffer.from(
            Buffer.from(body, "base64url").toString("utf8").replace("draft_abc", "draft_xyz"),
            "utf8"
        ).toString("base64url");
        expect(verifyRequestState(`${forgedBody}.${sig}`, binding)).toEqual({
            ok: false,
            reason: "signature",
        });
        const flipped = `${body}.${sig.slice(0, -2)}${sig.endsWith("AA") ? "BB" : "AA"}`;
        expect(verifyRequestState(flipped, binding).ok).toBe(false);
    });

    it("fails for strings that are not a state at all", () => {
        for (const raw of ["", "abc", "a.b.c", ".sig", "state-1"]) {
            expect(verifyRequestState(raw, binding).ok).toBe(false);
        }
    });

    it("fails when signed with another server's secret", () => {
        const state = signRequestState(binding, {});
        process.env.BETTER_AUTH_SECRET = "another-secret";
        try {
            expect(verifyRequestState(state, binding)).toEqual({ ok: false, reason: "signature" });
        } finally {
            process.env.BETTER_AUTH_SECRET = "test-secret-for-request-state";
        }
    });
});
