import { createUnsubscribeToken, isSuppressed } from "@launchstack/pipelines/email";

import { createEmailPipelineTestDatabase, type EmailPipelineTestDatabase } from "./testDb";

import { GET, POST } from "~/app/api/email-pipeline/unsubscribe/[token]/route";

/**
 * The unsubscribe ROUTE handlers (the token module has its own suite). The
 * invariant the file's design comment stakes out: GET renders a confirmation
 * and never mutates — mail scanners prefetch links — while POST (what RFC 8058
 * one-click clients send) performs the suppression.
 */

const describeIfDatabase =
    (process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL)
        ? describe
        : describe.skip;

const params = (token: string) => ({ params: Promise.resolve({ token }) });

describeIfDatabase("unsubscribe route", () => {
    jest.setTimeout(120_000);

    let harness: EmailPipelineTestDatabase;

    beforeAll(async () => {
        harness = await createEmailPipelineTestDatabase();
    }, 120_000);

    afterAll(async () => {
        await harness?.close();
    });

    it("GET renders confirmation without suppressing (scanner-prefetch safe)", async () => {
        const companyId = await harness.createCompany();
        const token = createUnsubscribeToken({
            companyId,
            email: "get@example.com",
        });

        const res = await GET(new Request("https://example.com"), params(token));
        expect(res.status).toBe(200);
        expect(await isSuppressed(companyId, "get@example.com")).toBe(false);
    });

    it("POST suppresses exactly the address inside the signed token", async () => {
        const companyId = await harness.createCompany();
        const token = createUnsubscribeToken({
            companyId,
            email: "post@example.com",
        });

        const res = await POST(new Request("https://example.com"), params(token));
        expect(res.status).toBe(200);
        expect(await isSuppressed(companyId, "post@example.com")).toBe(true);
        // Scoped to the company inside the token, not anyone else's list.
        const otherCompany = await harness.createCompany();
        expect(await isSuppressed(otherCompany, "post@example.com")).toBe(false);
    });

    it("rejects tampered and malformed tokens without mutating", async () => {
        const companyId = await harness.createCompany();
        const token = createUnsubscribeToken({
            companyId,
            email: "victim@example.com",
        });
        const forged = token.replace(`.${companyId}.`, `.${companyId + 1}.`);

        expect((await POST(new Request("https://example.com"), params(forged))).status).toBe(400);
        expect((await POST(new Request("https://example.com"), params("%zz"))).status).toBe(400);
        expect((await POST(new Request("https://example.com"), params("junk"))).status).toBe(400);
        expect(await isSuppressed(companyId, "victim@example.com")).toBe(false);
        expect(await isSuppressed(companyId + 1, "victim@example.com")).toBe(false);
    });
});
