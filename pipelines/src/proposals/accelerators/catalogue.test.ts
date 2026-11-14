import { describe, expect, it } from "vitest";

import { applicationRoutes, dealPassages, type Finding } from "./catalogue";

const found = (...values: string[]): Finding<string>[] =>
    values.map((value, index) => ({ value, evidenceId: `e${index}` }));

describe("dealPassages", () => {
    it("joins overlapping quote windows back into the verbatim passage", () => {
        const page =
            "Founders receive up to $400,000 from inception. Here is exactly how the investment works: $100,000 for 10% equity via SAFE.";
        const { values, evidenceIds } = dealPassages(
            found(page.slice(0, 80), page.slice(40, 124), page.slice(60))
        );
        expect(values).toEqual([page]);
        expect(evidenceIds).toEqual(["e0", "e1", "e2"]);
    });

    it("cuts at sentence boundaries, and marks a cut edge with an ellipsis when there is none", () => {
        const { values } = dealPassages(
            found(
                "of $225,000 for a 12% equity stake. Antler receives a $68,000 platform fee. Then the",
                "for Personal & Business Expenses $100K living stipend per year $100K in R&D support and"
            )
        );
        expect(values).toEqual([
            "Antler receives a $68,000 platform fee.",
            "…for Personal & Business Expenses $100K living stipend per year $100K in R&D support and…",
        ]);
    });
});

describe("applicationRoutes", () => {
    it("keeps one route per page, preferring https and dropping tracking parameters", () => {
        const { values } = applicationRoutes(
            found(
                "http://www.antler.co/apply",
                "https://www.antler.co/apply/",
                "https://antler.co/residency/australia?utm_source=referral&city=sydney#form",
                "https://antler.co/residency/australia?city=sydney"
            )
        );
        expect(values).toEqual([
            "https://www.antler.co/apply/",
            "https://antler.co/residency/australia?city=sydney",
        ]);
    });

    it("keeps application addresses as written", () => {
        expect(applicationRoutes(found("mailto:apply@ycombinator.com")).values).toEqual([
            "mailto:apply@ycombinator.com",
        ]);
    });
});
