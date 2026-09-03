import { createHmac } from "node:crypto";

import { verifyGithubSignature } from "~/server/services/github-webhook";

const SECRET = "webhook-secret";

function sign(body: string, secret = SECRET): string {
    return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("verifyGithubSignature", () => {
    const body = JSON.stringify({ repository: { full_name: "octo/demo" } });

    it("accepts a correctly signed body", () => {
        expect(verifyGithubSignature(SECRET, body, sign(body))).toBe(true);
    });

    it("rejects a signature made with the wrong secret", () => {
        expect(verifyGithubSignature(SECRET, body, sign(body, "other-secret"))).toBe(false);
    });

    it("rejects a signature over a different body", () => {
        expect(verifyGithubSignature(SECRET, body, sign(`${body} `))).toBe(false);
    });

    it("rejects a missing header", () => {
        expect(verifyGithubSignature(SECRET, body, null)).toBe(false);
    });

    it("rejects the sha1 header format GitHub also sends", () => {
        const sha1 = `sha1=${createHmac("sha1", SECRET).update(body).digest("hex")}`;
        expect(verifyGithubSignature(SECRET, body, sha1)).toBe(false);
    });

    it("rejects a truncated signature without throwing", () => {
        expect(verifyGithubSignature(SECRET, body, "sha256=abc123")).toBe(false);
    });

    it("rejects non-hex garbage of the right length without throwing", () => {
        expect(verifyGithubSignature(SECRET, body, `sha256=${"z".repeat(64)}`)).toBe(false);
    });
});
