/** @jest-environment jsdom */

/**
 * The generator's Publish with the claim gate: a post whose claims the
 * documents don't back asks first and sends nothing until the member
 * confirms; confirming sends the acknowledgement; a post the server finds
 * unbacked (an edit added a claim) comes back as the same question; and a
 * fully supported post publishes straight away.
 */
import { act, renderHook, waitFor } from "@testing-library/react";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));

import {
    MARKETING_ACTIVE_SESSION_KEY,
    MARKETING_SESSIONS_STORAGE_KEY,
} from "~/app/employer/documents/components/marketing-pipeline/shared";
import { useMarketingPipelineController } from "~/app/employer/documents/components/marketing-pipeline/useMarketingPipelineController";

const SUPPORTED = {
    claim: "Onboarding is 40% faster",
    match: { sourceDoc: "Handbook", excerpt: "Onboarding is 40% faster", relevance: 0.9 },
    support: "supported",
};
const UNBACKED = {
    claim: "We are SOC 2 certified",
    match: { sourceDoc: "Security overview", excerpt: "We plan a SOC 2 audit", relevance: 0.86 },
    support: "unsupported",
    reason: "Only plans for an audit are mentioned.",
};

function seed(claimSources: unknown[]) {
    const session = {
        id: "s1",
        createdAt: 1,
        updatedAt: 1,
        platform: "linkedin",
        prompt: "Announce",
        result: {
            platform: "linkedin",
            message: "Onboarding is 40% faster and we are SOC 2 certified.",
            "image/video": "image",
            research: [],
            normalizedInput: { platform: "linkedin", prompt: "Announce" },
            claimSources,
        },
        editableMessage: "Onboarding is 40% faster and we are SOC 2 certified.",
        viewMode: "preview",
    };
    sessionStorage.setItem(MARKETING_SESSIONS_STORAGE_KEY, JSON.stringify([session]));
    sessionStorage.setItem(MARKETING_ACTIVE_SESSION_KEY, "s1");
}

const reply = (status: number, body: unknown) =>
    Promise.resolve({ ok: status < 400, status, json: async () => body } as unknown as Response);

let fetchMock: jest.Mock;
beforeEach(() => {
    sessionStorage.clear();
    fetchMock = jest.fn(() =>
        reply(200, { success: true, data: { postUrl: "https://li/1", channel: "Acme" } })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
});

async function mounted() {
    const hook = renderHook(() => useMarketingPipelineController({ debug: false }));
    await waitFor(() => expect(hook.result.current.result).not.toBeNull());
    return hook;
}

const bodyOf = (call: unknown[]) =>
    JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;

it("asks before publishing a post with an unbacked claim, and sends nothing until confirmed", async () => {
    seed([SUPPORTED, UNBACKED]);
    const { result } = await mounted();
    await act(async () => {
        await result.current.publishPost();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.claimGate?.claims.map(c => c.claim)).toEqual(["We are SOC 2 certified"]);

    await act(async () => {
        await result.current.confirmClaimGate();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock.mock.calls[0])).toMatchObject({ acknowledgeUnsupportedClaims: true });
    expect(result.current.claimGate).toBeNull();
    expect(result.current.publishResult).toMatchObject({ success: true });
});

it("going back to edit publishes nothing", async () => {
    seed([UNBACKED]);
    const { result } = await mounted();
    await act(async () => {
        await result.current.publishPost();
    });
    act(() => result.current.dismissClaimGate());
    expect(result.current.claimGate).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
});

it("a fully supported post publishes straight away; the server's 409 becomes the same question", async () => {
    seed([SUPPORTED]);
    fetchMock.mockImplementationOnce(() =>
        reply(409, {
            success: false,
            code: "unsupported_claims",
            unavailable: false,
            claims: [
                {
                    claim: "Added in the editor",
                    support: "unsupported",
                    reason: null,
                    sourceDoc: null,
                },
            ],
        })
    );
    const { result } = await mounted();
    await act(async () => {
        await result.current.publishPost();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock.mock.calls[0]).acknowledgeUnsupportedClaims).toBeUndefined();
    expect(result.current.claimGate?.claims[0]?.claim).toBe("Added in the editor");
    expect(result.current.publishResult).toBeNull();
});
