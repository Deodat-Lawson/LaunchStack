/**
 * The grounding gate: a fact survives only with a quote copied from a passage
 * of its call, and every number in the value inside that quote. Survivors
 * carry their own page, quote and chunk as provenance.
 */
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { describe, expect, it } from "vitest";

import {
    ExtractionOutputSchema,
    countFacts,
    extractSourceFacts,
    groundFact,
    type ExtractionOutput,
    type GenerateStructuredFn,
} from "./extractor";
import type { Passage } from "./passages";

const PASSAGES: Passage[] = [
    {
        chunkId: 101,
        page: 1,
        text: "Acme Robotics builds warehouse robots. Founded in 2019, we are headquartered in Baltimore, MD.",
    },
    {
        chunkId: 102,
        page: 2,
        text: "Jane Doe is our CEO. Our Pick-bot moves 1,200 totes an hour for mid-size grocers.",
    },
];
const numbered = PASSAGES.map((p, i) => ({ ...p, n: i + 1 }));

const cited = (value: string | number, quote: string, passage: number, confidence = 0.9) => ({
    value: String(value),
    quote,
    passage,
    confidence,
    visibility: "public" as const,
    usage: "outreach_ok" as const,
});

const say = (
    section: ExtractionOutput["facts"][number]["section"],
    field: string,
    value: string,
    quote: string,
    passage: number,
    subject: string | null = null,
    confidence = 0.9
) => ({ section, subject, field, ...cited(value, quote, passage, confidence) });

describe("groundFact", () => {
    it("accepts a verbatim quote from the named passage", () => {
        expect(
            groundFact(
                cited("Baltimore, MD", "we are headquartered in Baltimore, MD.", 1),
                numbered
            )?.chunkId
        ).toBe(101);
    });
    it("accepts a quote copied from a neighbouring passage of the same call", () => {
        expect(groundFact(cited("CEO", "Jane Doe is our CEO.", 1), numbered)?.chunkId).toBe(102);
    });
    it("rejects a paraphrase", () => {
        expect(
            groundFact(
                cited("Baltimore", "The company is based in Baltimore, Maryland.", 1),
                numbered
            )
        ).toBeNull();
    });
    it("rejects a value with a number the quote does not contain", () => {
        expect(
            groundFact(
                cited("1,500 totes an hour", "Our Pick-bot moves 1,200 totes an hour", 2),
                numbered
            )
        ).toBeNull();
        expect(
            groundFact(
                cited("1,200 totes an hour", "Our Pick-bot moves 1,200 totes an hour", 2),
                numbered
            )
        ).not.toBeNull();
    });
});

describe("extractSourceFacts", () => {
    it("keeps grounded facts with their page, quote and chunk, and counts what the gate rejected", async () => {
        const output: ExtractionOutput = {
            facts: [
                say(
                    "company",
                    "name",
                    "Acme Robotics",
                    "Acme Robotics builds warehouse robots.",
                    1
                ),
                say(
                    "company",
                    "founded_year",
                    "2019",
                    "Founded in 2019, we are headquartered in Baltimore, MD.",
                    1
                ),
                say(
                    "company",
                    "headquarters",
                    "Seattle, WA",
                    "Seattle, United States. Association for Computational Linguistics.",
                    1
                ),
                say("people", "name", "Jane Doe", "Jane Doe is our CEO.", 2, "Jane Doe"),
                say("people", "role", "CEO", "Jane Doe is our CEO.", 2, "null"),
                say("people", "role", "CEO", "Jane Doe is our CEO.", 2, "Jane Doe"),
                say(
                    "people",
                    "name",
                    "Tong Chen",
                    "Tong Chen University of Washington",
                    1,
                    "Tong Chen"
                ),
                say(
                    "people",
                    "role",
                    "Advisor",
                    "Our Pick-bot moves 1,200 totes an hour",
                    2,
                    "Sam Lee"
                ),
                say(
                    "services",
                    "name",
                    "Pick-bot",
                    "Our Pick-bot moves 1,200 totes an hour",
                    2,
                    "the Pick bot"
                ),
                say("profile", "customers", "Mid-size grocers", "for mid-size grocers", 2),
                say(
                    "company",
                    "name",
                    "Acme Robotics Inc.",
                    "Acme Robotics builds warehouse robots.",
                    1,
                    null,
                    0.5
                ),
                say("profile", "made_up_key", "x", "for mid-size grocers", 2),
                say("markets", "primary", "Grocery", "nothing like this appears", 2, null, 0.3),
            ],
        };
        const generate: GenerateStructuredFn = async () => output as never;
        const result = await extractSourceFacts({
            companyName: "Acme Robotics",
            documentId: 9,
            documentName: "Deck.pdf",
            versionId: 4,
            passages: PASSAGES,
            generate,
            now: new Date("2026-10-03T12:00:00Z"),
        });
        expect(result.calls).toBe(1);
        // The Seattle headquarters and the paper author (not in any passage), and Sam Lee
        // (the quote does not name him). A "null" subject on a role has no one to attach to.
        // And "Acme Robotics Inc.": a name the quote does not contain is a guess.
        expect(result.rejected).toBe(4);
        expect(result.facts.company?.headquarters).toBeUndefined();
        expect(result.facts.company?.founded_year?.value).toBe(2019);
        expect(result.facts.people?.map(p => p.name.value)).toEqual(["Jane Doe"]);
        expect(result.facts.company?.name?.sources[0]).toMatchObject({
            doc_id: 9,
            doc_name: "Deck.pdf",
            version_id: 4,
            page: 1,
            quote: "Acme Robotics builds warehouse robots.",
            snippet_ref: "chunk:101",
        });
        expect(result.facts.profile?.facts?.customers?.label).toBe("Customers");
        expect(result.facts.markets).toBeUndefined(); // below the confidence bar
        expect(result.factCount).toBe(countFacts(result.facts));
        // "the Pick bot" is named by "Our Pick-bot moves…": its words are all there.
        expect(result.facts.services?.map(s => s.name.value)).toEqual(["Pick-bot"]);
        expect(result.factCount).toBe(6);
    });

    it("records a failed call and still returns what the others found", async () => {
        let call = 0;
        const generate: GenerateStructuredFn = async () => {
            call++;
            throw new Error("rate limited");
        };
        const result = await extractSourceFacts({
            companyName: "Acme",
            documentId: 9,
            documentName: "Deck.pdf",
            versionId: null,
            passages: PASSAGES,
            generate,
        });
        expect(call).toBe(1);
        expect(result).toMatchObject({ calls: 1, failedCalls: 1, factCount: 0 });
    });
});

describe("ExtractionOutputSchema", () => {
    it("converts to a JSON schema with no $refs (Gemini rejects them)", () => {
        expect(JSON.stringify(toJsonSchema(ExtractionOutputSchema))).not.toContain("$ref");
    });
});
