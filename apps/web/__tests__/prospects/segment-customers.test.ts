/**
 * Saving "Customers like these" on a segment: websites are stored as bare
 * domains, each once; anything that is not a website, or more than the
 * cap, is refused with a sentence in the reader's language.
 */
import type { ProgramPatch, ProgramRecord } from "@launchstack/pipelines/distribution/types";

const mockUpdateProgram = jest.fn();

jest.mock("@launchstack/pipelines/distribution/db", () => ({
    getProgram: jest.fn(async () => mockCurrent),
    updateProgram: (...args: unknown[]) => mockUpdateProgram(...args),
    listPartners: jest.fn(async () => []),
    listRuns: jest.fn(async () => []),
    listExclusions: jest.fn(async () => ({ domains: [], keys: [] })),
}));

jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: jest.fn(),
}));

import { handleProspectsError } from "~/app/api/prospects/_http";
import { patchSegment, ProspectsError } from "~/server/prospects/service";

let mockCurrent: ProgramRecord;
const ctx = { companyId: 1n, userId: "u1", userPk: 1 };

beforeEach(() => {
    mockCurrent = {
        id: "prog-1",
        companyId: 1n,
        createdByUserId: "u1",
        name: "NL fulfilment",
        offering: "Picking robots",
        categories: [],
        hsCodes: [],
        targetTerritories: [{ country: "NL" }],
        partnerKinds: ["distributor"],
        constraints: null,
        knownPartnerDomains: [],
        customerDomains: [],
        status: "active",
        createdAt: new Date("2026-10-01T00:00:00Z"),
        updatedAt: null,
    };
    mockUpdateProgram.mockReset();
    mockUpdateProgram.mockImplementation(async (_id: string, _c: bigint, patch: ProgramPatch) => {
        mockCurrent = { ...mockCurrent, ...patch } as ProgramRecord;
        return mockCurrent;
    });
});

describe("patchSegment seedDomains", () => {
    it("stores bare, de-duplicated domains and shows them on the segment", async () => {
        const segment = await patchSegment(ctx, "prog-1", {
            seedDomains: ["https://www.Delta.example/about", "pickpoint.example delta.example"],
        });
        expect(mockUpdateProgram).toHaveBeenCalledWith("prog-1", 1n, {
            customerDomains: ["delta.example", "pickpoint.example"],
        });
        expect(segment.fields.find(f => f.key === "seedDomains")!.value).toEqual([
            "delta.example",
            "pickpoint.example",
        ]);
    });

    it("clears the list", async () => {
        mockCurrent = { ...mockCurrent, customerDomains: ["delta.example"] };
        await patchSegment(ctx, "prog-1", { seedDomains: [] });
        expect(mockUpdateProgram).toHaveBeenCalledWith("prog-1", 1n, { customerDomains: [] });
    });

    it("refuses what is not a website, in the reader's language", async () => {
        const refused = await patchSegment(ctx, "prog-1", {
            seedDomains: ["delta.example", "acme"],
        }).catch((e: unknown) => e);
        expect(refused).toBeInstanceOf(ProspectsError);
        expect((refused as ProspectsError).status).toBe(400);
        expect((refused as ProspectsError).message).toBe(
            "“acme” is not a website. Use a domain such as acme.com."
        );
        const zh = new Request("http://localhost/api/prospects/segments/prog-1", {
            headers: { cookie: "ls-locale=zh-CN.1" },
        });
        expect(await handleProspectsError("PATCH segment", refused, zh).json()).toEqual({
            error: "“acme”不是网站。请使用 acme.com 这样的域名。",
        });
        expect(mockUpdateProgram).not.toHaveBeenCalled();
    });

    it("refuses more than 25 customers", async () => {
        const many = Array.from({ length: 26 }, (_, i) => `customer-${i}.example`);
        await expect(patchSegment(ctx, "prog-1", { seedDomains: many })).rejects.toMatchObject({
            status: 400,
            message: "List up to 25 customer websites.",
        });
    });
});
