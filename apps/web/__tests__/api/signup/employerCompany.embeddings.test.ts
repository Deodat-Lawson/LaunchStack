/**
 * Signing up with your own embeddings key: the key needs the endpoint it
 * belongs to, and that endpoint passes the same address policy as Settings.
 * Both are refused before a company row is written.
 */

jest.mock("~/server/db", () => ({
    db: jest.requireActual("../../helpers/fake-db").fakeDb.db,
}));
jest.mock("~/lib/require-workspace-context", () => ({
    requireAuthIdentity: jest.fn(async () => ({ success: true, data: { authUserId: "user-x" } })),
}));
jest.mock("~/server/deployment", () => ({ isCloudDeployment: () => true }));

import { company } from "@launchstack/store/schema";

import { POST } from "~/app/api/signup/employerCompany/route";

import { fakeDb } from "../../helpers/fake-db";

function request(body: Record<string, unknown>): Request {
    return new Request("http://localhost/api/signup/employerCompany", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            name: "Amy",
            email: "amy@example.com",
            companyName: "Acme",
            ...body,
        }),
    });
}

beforeEach(() => {
    fakeDb.reset();
    fakeDb.onSelect(company, []);
});

describe("POST /api/signup/employerCompany with an embeddings key", () => {
    it("refuses a key without its endpoint", async () => {
        const response = await POST(request({ embeddingOpenAIApiKey: "sk-test-123456" }));
        expect(response.status).toBe(400);
        expect(JSON.stringify(await response.json())).toMatch(/endpoint URL/);
        expect(fakeDb.insertedInto(company)).toHaveLength(0);
    });

    it("refuses an endpoint inside a private network on the hosted service", async () => {
        const response = await POST(
            request({
                embeddingOpenAIApiKey: "sk-test-123456",
                embeddingOpenAIBaseUrl: "https://10.0.0.4/v1",
            })
        );
        expect(response.status).toBe(400);
        expect(JSON.stringify(await response.json())).toMatch(/private network/);
        expect(fakeDb.insertedInto(company)).toHaveLength(0);
    });
});
