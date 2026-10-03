/**
 * What Investor relations says about a fund, asks the chat to write, and
 * saves as a source. The prompts matter most: a draft that invents a
 * fund's thesis, or an investor memo with a made-up number, is worse than
 * none — so these pin that the prompts say what is known and what is not.
 */

import {
    describeRaise,
    formatUsd,
    fundsMarkdown,
    introPrompt,
    PITCH_STARTERS,
    resultSummary,
    sortFunds,
    websiteSearchUrl,
    type FundProfile,
} from "../investors/investors";

function fund(over: Partial<FundProfile> = {}): FundProfile {
    return {
        cik: "0002129288",
        name: "DCVC Energy & Climate II, L.P.",
        location: "Palo Alto, CA",
        state: "CA",
        filedAt: "2026-05-29",
        amendment: false,
        filingUrl:
            "https://www.sec.gov/Archives/edgar/data/2129288/000212928826000002/xslFormDX01/primary_doc.xml",
        phone: "415-840-7337",
        fundType: "Venture Capital Fund",
        offeringAmount: 500_000_000,
        amountSold: 0,
        managers: [
            {
                name: "Zachary Bogue",
                kind: "person",
                roles: ["Executive Officer"],
                title: "Managing Member of the General Partner",
            },
            { name: "Matthew Ocko", kind: "person", roles: ["Executive Officer"] },
            { name: "DCVC GP II, LLC", kind: "entity", roles: ["Promoter"] },
        ],
        detailed: true,
        ...over,
    };
}

describe("money", () => {
    it.each([
        [500_000_000, "$500M"],
        [21_450_000, "$21.5M"],
        [1_890_486_304, "$1.9B"],
        [750_000, "$750K"],
        [900, "$900"],
    ])("says %d as %s", (amount, said) => {
        expect(formatUsd(amount)).toBe(said);
    });

    it("says what the fund is raising and what has closed", () => {
        expect(describeRaise(fund())).toBe("Raising $500M · nothing closed yet");
        expect(describeRaise(fund({ offeringAmount: 80_000_000, amountSold: 21_000_000 }))).toBe(
            "Raising $80M · $21M closed"
        );
        expect(describeRaise(fund({ offeringAmount: null, amountSold: 1_890_486_304 }))).toBe(
            "Size not stated · $1.9B closed"
        );
    });

    it("claims nothing about a fund whose filing could not be read", () => {
        expect(describeRaise(fund({ detailed: false }))).toBeUndefined();
    });
});

describe("sorting", () => {
    const funds = [
        fund({ cik: "a", filedAt: "2026-01-01", offeringAmount: 10_000_000 }),
        fund({ cik: "b", filedAt: "2026-09-01", offeringAmount: null, amountSold: 0 }),
        fund({ cik: "c", filedAt: "2026-05-01", offeringAmount: null, amountSold: 900_000_000 }),
    ];

    it("puts the newest filing first", () => {
        expect(sortFunds(funds, "newest").map(f => f.cik)).toEqual(["b", "c", "a"]);
    });

    it("puts the largest first, counting money closed when no size is stated", () => {
        expect(sortFunds(funds, "largest").map(f => f.cik)).toEqual(["c", "a", "b"]);
    });
});

describe("the intro prompt", () => {
    it("addresses the first person on the filing and states what the filing says", () => {
        const prompt = introPrompt(fund());
        expect(prompt).toContain(
            "cold intro email to Zachary Bogue (Managing Member of the General Partner) at DCVC Energy & Climate II, L.P."
        );
        expect(prompt).toContain("Palo Alto, CA");
        expect(prompt).toContain("2026-05-29");
        expect(prompt).toContain("Raising $500M · nothing closed yet");
        expect(prompt).toContain("Other people named on the filing: Matthew Ocko.");
        // The general partner entity is not a person to write to.
        expect(prompt).not.toContain("DCVC GP II");
    });

    it("grounds the pitch in the workspace and forbids inventing a thesis", () => {
        const prompt = introPrompt(fund());
        expect(prompt).toMatch(/workspace sources/);
        expect(prompt).toMatch(/says nothing about their investment thesis/);
    });

    it("writes to the partners when no person is named", () => {
        const prompt = introPrompt(fund({ managers: [], detailed: false }));
        expect(prompt).toContain("cold intro email to the partners at");
        expect(prompt).not.toContain("Raising");
    });
});

describe("pitch starters", () => {
    it("each drafts from the workspace's sources and asks for what is missing", () => {
        expect(PITCH_STARTERS.map(s => s.id)).toEqual([
            "one-pager",
            "deck",
            "hard-questions",
            "metrics",
            "update",
            "data-room",
        ]);
        for (const starter of PITCH_STARTERS) {
            expect(starter.prompt).toMatch(/workspace sources/);
            expect(starter.prompt).toMatch(/cite|source that backs|name the document/i);
        }
    });
});

describe("saving the list", () => {
    it("writes a source the chat can cite: who, where, how much, and the filing", () => {
        const md = fundsMarkdown(
            [fund()],
            { q: "climate", state: "CA", withinDays: 90 },
            new Date("2026-09-23T00:00:00Z")
        );
        expect(md).toContain("# Venture funds raising — 2026-09-23");
        expect(md).toContain('matching "climate", in CA, filed in the last 90 days');
        expect(md).toContain("## DCVC Energy & Climate II, L.P.");
        expect(md).toContain("- Office: Palo Alto, CA");
        expect(md).toContain("- Raising $500M · nothing closed yet");
        expect(md).toContain("- Person: Zachary Bogue — Managing Member of the General Partner");
        expect(md).toContain("- Managed by: DCVC GP II, LLC — Promoter");
        expect(md).toContain("- Filing: https://www.sec.gov/Archives/edgar/data/2129288/");
    });
});

describe("links and summary", () => {
    it("searches the web for the fund without its legal suffix", () => {
        const url = new URL(websiteSearchUrl(fund({ name: "Overture Climate Fund II LP" })));
        expect(url.searchParams.get("q")).toBe("Overture Climate Fund II venture capital");
    });

    it("says how many funds, out of how many filings, and what was hidden", () => {
        const result = {
            funds: [fund()],
            totalFilings: 10_000,
            singleDealVehiclesHidden: 65,
            source: "sec-edgar-form-d" as const,
        };
        expect(resultSummary(result, 1)).toBe(
            "1 fund · 10,000+ filings in the window · 65 single-deal vehicles hidden"
        );
        expect(resultSummary({ ...result, totalFilings: 1, singleDealVehiclesHidden: 0 }, 1)).toBe(
            "1 fund"
        );
    });
});
