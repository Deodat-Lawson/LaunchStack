const mockBetaApps = jest.fn();
const mockSegments = jest.fn();
const mockCompanies = jest.fn();
jest.mock("~/server/beta-apps", () => ({ betaAppsOn: (...a: unknown[]) => mockBetaApps(...a) }));
jest.mock("~/server/prospects/service", () => ({
    listSegments: (...a: unknown[]) => mockSegments(...a),
    listCompanies: (...a: unknown[]) => mockCompanies(...a),
}));

import { listProspectsTool } from "~/server/mcp/tools/list-prospects";

const principal = {
    ctx: { companyId: 50n, authUserId: "user-a", userPk: 7n, can: () => true },
    scopes: new Set(["launchstack:read"]),
    credential: { kind: "key", keyId: 3 },
    label: "Claude Code",
    family: "claude",
    rateLimitKey: "mcp:user-a:50",
} as never;

const call = (args: Record<string, unknown>) =>
    listProspectsTool.call(args, {
        principal,
        origin: "https://app.example",
        client: { era: "legacy", formElicitation: false },
        roundTrip: null,
        rawArguments: args,
    } as never);

const company = (over: Record<string, unknown>) => ({
    id: "d1",
    name: "Charm City Cafe",
    domain: "charmcity.example",
    hq: "Baltimore, US",
    fit: 82,
    stage: "lead",
    why: "A Baltimore café.",
    imageUrl: "https://charmcity.example/og.jpg",
    iconUrl: null,
    excluded: false,
    ...over,
});

beforeEach(() => {
    jest.clearAllMocks();
    mockBetaApps.mockResolvedValue(true);
    mockSegments.mockResolvedValue([
        { id: "seg-1", name: "Cafés in Baltimore", counts: { companies: 3 } },
        { id: "seg-2", name: "Grocers", counts: { companies: 1 } },
    ]);
    mockCompanies.mockResolvedValue({
        companies: [
            company({}),
            company({ id: "d2", name: "Low Fit Diner", fit: 30 }),
            company({ id: "d3", name: "Excluded Co", excluded: true }),
        ],
    });
});

describe("list_prospects", () => {
    it("lists a segment's companies best first, with links, pictures and filters", async () => {
        const out = (await call({ segment: "cafés in baltimore", minFit: 50 })) as {
            ok: true;
            structured: Record<string, unknown>;
        };
        expect(out.ok).toBe(true);
        expect(mockCompanies).toHaveBeenCalledWith(
            expect.objectContaining({ companyId: 50n, userId: "user-a" }),
            "seg-1",
            { view: "all", q: "", sort: "fit" }
        );
        expect(out.structured.segment).toEqual({ id: "seg-1", name: "Cafés in Baltimore" });
        expect(out.structured.segments).toEqual([
            { id: "seg-1", name: "Cafés in Baltimore", companies: 3 },
            { id: "seg-2", name: "Grocers", companies: 1 },
        ]);
        const companies = out.structured.companies as Array<Record<string, unknown>>;
        expect(companies.map(c => c.name)).toEqual(["Charm City Cafe"]);
        expect(companies[0]).toMatchObject({
            website: "https://charmcity.example",
            imageUrl: "https://charmcity.example/og.jpg",
        });
        expect(decodeURIComponent(companies[0]!.url as string)).toContain(
            "/prospects/companies/d1"
        );
        expect(companies[0]!.url).toMatch(/^https:\/\/app\.example\//);
    });

    it("refuses while the workspace has its beta apps off, and names an unknown segment", async () => {
        mockBetaApps.mockResolvedValue(false);
        const off = (await call({})) as { ok: false; message: string };
        expect(off.ok).toBe(false);
        expect(off.message).toMatch(/beta/i);
        mockBetaApps.mockResolvedValue(true);
        const missing = (await call({ segment: "Nope" })) as { ok: false; message: string };
        expect(missing.ok).toBe(false);
        expect(missing.message).toContain("Nope");
    });
});
