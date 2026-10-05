/**
 * /api/company/onboarding. POST saves the answers and reassembles the profile
 * only when they changed a fact; GET hands back what is already known so a
 * second pass starts filled in. Writing is settings.manage; reading is any
 * member, since every member sees the profile.
 */
import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";
import type { StubbedContextResult } from "../../helpers/mock-require-workspace-context";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn<StubbedContextResult, []>();
jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

const mockSave = jest.fn();
const mockLoad = jest.fn();
jest.mock("~/server/company-profile/onboarding", () => ({
    saveOnboarding: (...args: unknown[]) => mockSave(...args),
    loadOnboarding: (...args: unknown[]) => mockLoad(...args),
}));

const mockReassemble = jest.fn();
jest.mock("~/server/company-profile/service", () => ({
    reassembleAfterResponse: (...args: unknown[]) => mockReassemble(...args),
}));

import { GET, POST } from "~/app/api/company/onboarding/route";

function post(body: unknown) {
    return POST(
        new Request("http://localhost/api/company/onboarding", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        })
    );
}

beforeEach(() => {
    jest.clearAllMocks();
    mockRequireWorkspaceContext.mockReturnValue({
        success: true,
        data: makeWorkspaceContext({ role: "owner", companyId: BigInt(5), authUserId: "user-a" }),
    });
    mockReassemble.mockResolvedValue(undefined);
});

describe("POST /api/company/onboarding", () => {
    it("saves the answers and reassembles the profile", async () => {
        mockSave.mockResolvedValue({ website: "https://acme.com/", facts: 2 });

        const res = await post({ website: "acme.com", idea: "Anvils by subscription." });

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({ success: true, website: "https://acme.com/" });
        expect(mockSave).toHaveBeenCalledWith(
            expect.objectContaining({ companyId: BigInt(5), authUserId: "user-a" }),
            { website: "acme.com", idea: "Anvils by subscription." }
        );
        expect(mockReassemble).toHaveBeenCalledWith(BigInt(5), "user-a");
    });

    it("does not rebuild when no fact changed", async () => {
        mockSave.mockResolvedValue({ website: null, facts: 0 });
        const res = await post({ industry: "Legal" });
        expect(res.status).toBe(200);
        expect(mockReassemble).not.toHaveBeenCalled();
    });

    it("refuses answers longer than the limits", async () => {
        const res = await post({ website: `https://acme.com/${"a".repeat(2100)}` });
        expect(res.status).toBe(400);
        expect(mockSave).not.toHaveBeenCalled();

        const idea = await post({ idea: "a".repeat(5001) });
        expect(idea.status).toBe(400);
    });

    it("is for admins: a member gets 403 and nothing is saved", async () => {
        mockRequireWorkspaceContext.mockReturnValue({
            success: true,
            data: makeWorkspaceContext({ role: "member" }),
        });
        const res = await post({ website: "acme.com" });
        expect(res.status).toBe(403);
        expect(mockSave).not.toHaveBeenCalled();
    });
});

describe("GET /api/company/onboarding", () => {
    it("returns what onboarding already knows, to any member", async () => {
        mockRequireWorkspaceContext.mockReturnValue({
            success: true,
            data: makeWorkspaceContext({ role: "member", companyId: BigInt(5) }),
        });
        const state = {
            name: "Acme",
            website: "https://acme.com/",
            description: "We make anvils.",
            idea: null,
            industry: "Manufacturing",
        };
        mockLoad.mockResolvedValue(state);

        const res = await GET();
        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual(state);
        expect(mockLoad).toHaveBeenCalledWith(expect.objectContaining({ companyId: BigInt(5) }));
    });
});
