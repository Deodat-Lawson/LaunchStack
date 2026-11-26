/**
 * A name is not an identity. Trend search runs on words taken from the
 * company's context and the user's request, so its hits include unrelated
 * companies and products that are merely called the same thing; the
 * synthesizer once summarised a real app named like the workspace's product
 * as "essential product context" for it. It now says who each result is
 * about, and a namesake never leaves this function.
 */
import type { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";

vi.mock("@launchstack/llm", () => ({
    resolveChatModel: vi.fn(() => ({})),
    invokeStructured: vi.fn(),
}));

import { invokeStructured } from "@launchstack/llm";

import { synthesizeResults } from "./synthesizer";
import type { RawSearchResult } from "./types";

const mockInvoke = vi.mocked(invokeStructured);

const COMPANY =
    "Company: LaunchStack Dev.\nDescription: Makes Harbor, a workspace for a startup's documents.";

const RAW: RawSearchResult[] = [
    {
        url: "https://news.example/show-hn-norms",
        title: "What gets a Show HN to the front page",
        content: "Plain titles and a working demo beat marketing copy.",
        score: 0.9,
    },
    {
        url: "https://harbor-app.example/",
        title: "Harbor: turn Macs into private local AI inference servers",
        content: "Harbor pools the Macs in your office into one inference cluster.",
        score: 0.8,
    },
    {
        url: "https://press.example/launchstack-dev-harbor",
        title: "LaunchStack Dev ships Harbor for startup documents",
        content: "The workspace answers questions from a company's own files.",
        score: 0.7,
    },
];

function modelSays(results: Array<Record<string, unknown>>): void {
    mockInvoke.mockResolvedValue({ results });
}

function shown(): { rules: string; input: string; schema: z.ZodTypeAny } {
    const [, schema, messages] = mockInvoke.mock.calls[0]!;
    return {
        schema: schema as z.ZodTypeAny,
        rules: (messages[0] as SystemMessage).content as string,
        input: (messages[1] as HumanMessage).content as string,
    };
}

beforeEach(() => {
    mockInvoke.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("synthesizeResults and a result that only shares the company's name", () => {
    it("tells the model a matching name is not the company", async () => {
        modelSays([]);
        await synthesizeResults(RAW, "Show HN launch", COMPANY);

        const { rules, input } = shown();
        expect(rules).toContain("WHO A RESULT IS ABOUT");
        expect(rules).toContain(
            "A matching name is not enough: a result is about this company only when the business it describes is the one in COMPANY CONTEXT."
        );
        expect(rules).toContain(
            "If the names match and the business differs, or you cannot tell, it is a namesake."
        );
        expect(rules).toContain(
            "Never write, in summary or description, that something a result describes belongs to the company"
        );
        expect(input).toContain(`COMPANY CONTEXT: ${COMPANY}`);
    });

    it("makes the model say who every result is about", async () => {
        modelSays([]);
        await synthesizeResults(RAW, "Show HN launch", COMPANY);

        const { schema } = shown();
        const result = { sourceUrl: RAW[0]!.url, summary: "s", description: "d" };
        expect(schema.safeParse({ results: [result] }).success).toBe(false);
        for (const subject of ["market", "company", "namesake"]) {
            expect(schema.safeParse({ results: [{ ...result, subject }] }).success).toBe(true);
        }
        expect(schema.safeParse({ results: [{ ...result, subject: "ours" }] }).success).toBe(false);
    });

    it("drops a namesake and pads the gap, so it reaches no caller", async () => {
        modelSays([
            {
                sourceUrl: RAW[0]!.url,
                summary: "Plain Show HN titles do best.",
                description: "Bears on how a launch post is worded.",
                subject: "market",
            },
            {
                sourceUrl: RAW[1]!.url,
                summary: "Harbor turns Macs into private local AI inference servers.",
                description: "A different product that shares the name Harbor.",
                subject: "namesake",
            },
        ]);

        const results = await synthesizeResults(RAW, "Show HN launch", COMPANY);

        expect(results).toHaveLength(5);
        expect(results[0]).toEqual({
            sourceUrl: RAW[0]!.url,
            summary: "Plain Show HN titles do best.",
            description: "Bears on how a launch post is worded.",
            subject: "market",
        });
        expect(JSON.stringify(results)).not.toContain("inference");
        expect(results.map(r => r.sourceUrl)).not.toContain(RAW[1]!.url);
        // The four after the survivor are the usual placeholders.
        expect(results.slice(1).every(r => r.sourceUrl === "" && r.subject === undefined)).toBe(
            true
        );
    });

    it("keeps a result about the company itself, labelled, for callers that want it", async () => {
        modelSays([
            {
                sourceUrl: RAW[2]!.url,
                summary: "LaunchStack Dev shipped Harbor.",
                description: "Coverage of the company's own launch.",
                subject: "company",
            },
        ]);

        const results = await synthesizeResults(RAW, "Show HN launch", COMPANY);

        expect(results[0]).toMatchObject({ sourceUrl: RAW[2]!.url, subject: "company" });
    });
});
