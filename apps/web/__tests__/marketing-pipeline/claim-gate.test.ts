/** The publishing gate checks every extracted claim, including claims after the draft preview's cap. */
const mockInvoke = jest.fn();
const mockRetrieve = jest.fn();
jest.mock("@launchstack/tools/llm", () => ({
    invokeToolStructured: (...args: unknown[]) => mockInvoke(...args),
}));
jest.mock("@launchstack/tools/grounded-retrieval", () => ({
    retrieveCompanySnippets: (...args: unknown[]) => mockRetrieve(...args),
    SNIPPET_POLICIES: { pinpoint: {} },
}));
jest.mock("~/server/workspace-models/scope", () => ({
    withWorkspaceChatModels: (_company: unknown, _use: unknown, fn: () => unknown) => fn(),
}));

import * as claimEvidence from "@launchstack/tools/claim-evidence";
import { claimGate } from "~/server/brand/claim-gate";

const CLAIMS = [
    "We roast coffee",
    "We sell beans",
    "We ship locally",
    "We sell wholesale",
    "We serve cafes",
    "Our coffee cures diabetes",
];

beforeEach(() => {
    jest.clearAllMocks();
    mockRetrieve.mockImplementation(async ({ query }: { query: string }) => ({
        results:
            query === CLAIMS[5]
                ? []
                : [{ pageContent: query, metadata: { documentTitle: "Company profile" } }],
    }));
    mockInvoke.mockImplementation(async (_model, _schema, _messages, name: string) => ({
        result:
            name === "claim_list"
                ? { claims: CLAIMS }
                : {
                      verdicts: CLAIMS.map((_, index) => ({
                          index,
                          verdict: "supported",
                          reason: "Stated.",
                      })),
                  },
    }));
});

afterEach(() => {
    jest.restoreAllMocks();
});

it("blocks an unsupported sixth claim even when the first five are supported", async () => {
    expect(await claimGate(1n, "reviewer", CLAIMS.join(". "))).toMatchObject({
        code: "unsupported_claims",
        unavailable: false,
        claims: [{ claim: CLAIMS[5], support: "unsupported" }],
    });
    expect(mockRetrieve).toHaveBeenCalledWith(expect.objectContaining({ query: CLAIMS[5] }));
});

it("allows a post with more than five claims when every claim is supported", async () => {
    mockRetrieve.mockImplementation(async ({ query }: { query: string }) => ({
        results: [{ pageContent: query, metadata: { documentTitle: "Company profile" } }],
    }));
    expect(await claimGate(1n, "reviewer", CLAIMS.join(". "))).toBeNull();
    expect(mockRetrieve).toHaveBeenCalledTimes(6);
});

it("blocks when the claim check cannot run", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("model unavailable"));
    expect(await claimGate(1n, "reviewer", "A factual post")).toEqual({
        code: "unsupported_claims",
        unavailable: true,
        claims: [],
    });
});

it.each([
    {
        claims: CLAIMS.slice(0, 5).map(claim => ({
            claim,
            support: "supported" as const,
            match: null,
        })),
        totalClaimsFound: 6,
    },
    { claims: [], totalClaimsFound: 0, unavailable: true },
])("requires acknowledgement when the check is incomplete", async result => {
    jest.spyOn(claimEvidence, "checkClaimSources").mockResolvedValueOnce(result);
    expect(await claimGate(1n, "reviewer", "A factual post")).toMatchObject({
        code: "unsupported_claims",
        unavailable: true,
    });
});
