import { describe, expect, it } from "vitest";

import { buildJudgePrompt } from "./judge";
import {
    buyerBrief,
    companyText,
    relevanceOf,
    relevanceShare,
    semanticRelevance,
    type EmbedTexts,
} from "./semantic";
import { fakeEmbed } from "./semantic.fixture";

const program = {
    offering: "Single-origin roasted specialty coffee beans for cafés and shops",
    categories: ["specialty coffee"],
    constraints: null,
};

describe("the buyer brief", () => {
    it("says who buys, what, and in which categories", () => {
        expect(buyerBrief(program, ["retailer", "wholesaler"])).toBe(
            "Retailers and shops, wholesalers that would buy, stock or resell this: Single-origin roasted specialty coffee beans for cafés and shops Categories: specialty coffee."
        );
        expect(buyerBrief({ ...program, categories: [] }, [])).toMatch(
            /^Businesses that would buy/
        );
    });

    it("reads a company by its own words", () => {
        expect(
            companyText({
                name: "Roast & Co",
                categories: ["shop=coffee"],
                description: "Coffee bar",
            })
        ).toBe("Roast & Co. (shop=coffee). Coffee bar");
    });
});

describe("relevance by meaning", () => {
    const brief = buyerBrief(program, ["retailer"]);

    it("puts a buyer above zero and an unrelated company below", async () => {
        const [cafe, software, hardware] = await semanticRelevance(fakeEmbed, brief, [
            "Bean There. Specialty coffee shop selling roasted coffee beans",
            "Mango. AI meeting notes for remote sales teams",
            "Tool Depot. Hardware store selling tools and paint",
        ]);
        expect(cafe).toBeGreaterThan(0);
        expect(software).toBeLessThanOrEqual(0);
        expect(hardware).toBeLessThanOrEqual(0);
    });

    it("cancels the model's baseline: a uniformly similar embedder ranks the same", async () => {
        // Every vector shifted toward one shared direction, the way some
        // models put any two business texts at 0.8 similarity.
        const shifted: EmbedTexts = async texts =>
            (await fakeEmbed(texts)).map(v => v.map((x, i) => (i === 1 ? x + 6 : x)));
        const texts = [
            "Specialty coffee shop selling roasted coffee beans",
            "AI meeting notes for remote sales teams",
        ];
        const plain = await semanticRelevance(fakeEmbed, brief, texts);
        const biased = await semanticRelevance(shifted, brief, texts);
        expect(plain[0]! > plain[1]!).toBe(true);
        expect(biased[0]! > biased[1]!).toBe(true);
        expect(biased[1]!).toBeLessThanOrEqual(0);
    });

    it("falls back to shared words when the embedder fails or is absent", async () => {
        const broken: EmbedTexts = async () => {
            throw new Error("401");
        };
        const companies = [{ name: "Specialty coffee importer" }, { name: "Mango" }];
        for (const embed of [broken, null]) {
            const r = await relevanceOf(embed, program, ["retailer"], companies);
            expect(r.method).toBe("lexical");
            expect(r.scores[0]).toBeGreaterThan(0);
            expect(r.scores[1]).toBe(0);
        }
        const semantic = await relevanceOf(fakeEmbed, program, ["retailer"], companies);
        expect(semantic.method).toBe("semantic");
    });

    it("turns relevance into a share of the rubric's topic points", () => {
        expect(relevanceShare(-0.2, "semantic")).toBe(0);
        expect(relevanceShare(0.2, "semantic")).toBeCloseTo(0.5);
        expect(relevanceShare(0.9, "semantic")).toBe(1);
        expect(relevanceShare(0.5, "lexical")).toBeCloseTo(0.75);
    });
});

describe("the fit check's prompt", () => {
    it("names the buyer and every candidate by id", () => {
        const prompt = buildJudgePrompt("Cafés that would buy coffee", [
            { id: "k1", name: "Bean There", text: "Bean There. Coffee shop" },
            { id: "k2", name: "Mango", text: "Mango. AI notes" },
        ]);
        expect(prompt).toContain("Who the seller wants: Cafés that would buy coffee");
        expect(prompt).toContain("- id k1: Bean There. Coffee shop");
        expect(prompt).toContain("- id k2: Mango. AI notes");
    });
});
