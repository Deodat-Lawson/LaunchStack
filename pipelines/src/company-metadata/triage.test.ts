/**
 * Sorting sources: the rules settle empty and noise-only sources without a
 * model; everything else is the model's call, with the reason it gives.
 */
import { describe, expect, it, vi } from "vitest";

import type { GenerateStructuredFn } from "./extractor";
import type { CleanResult } from "./passages";
import { openingOf, sourceKindOf, triageByRules, triageSource, type TriageInput } from "./triage";

const NONE = {
    references: 0,
    table: 0,
    figure: 0,
    boilerplate: 0,
    placeholder: 0,
    too_short: 0,
    duplicate: 0,
};

function cleaned(
    texts: string[],
    dropped: Partial<typeof NONE> = {},
    total = texts.length
): CleanResult {
    return {
        passages: texts.map((text, i) => ({ chunkId: i + 1, page: 1, text })),
        total,
        kept: texts.length,
        dropped: { ...NONE, ...dropped },
    };
}

const input = (c: CleanResult, kind: TriageInput["kind"] = "upload"): TriageInput => ({
    companyName: "LaunchStack Dev",
    known: [],
    title: "doc",
    folder: "Unfiled",
    kind,
    cleaned: c,
});

const LONG = "LaunchStack is an open-source startup operating system for founders. ".repeat(3);

describe("triageByRules", () => {
    it("calls a file with no chunks no_content", () => {
        expect(triageByRules(input(cleaned([], {}, 0)))).toMatchObject({
            role: "no_content",
            roleBy: "rules",
        });
    });
    it("names what was dropped when nothing is left", () => {
        expect(triageByRules(input(cleaned([], { references: 9, table: 4 }, 13)))?.reason).toBe(
            "Only reference lists and number tables — nothing about the organisation to read."
        );
        expect(triageByRules(input(cleaned([], { too_short: 2 }, 2)))?.reason).toBe(
            "Too little text to say anything about the organisation."
        );
    });
    it("calls a mindmap with a few words no_content", () => {
        expect(triageByRules(input(cleaned(["Hi", "Test Example"]), "mindmap"))?.reason).toBe(
            "A mindmap with only a few words on it."
        );
        expect(triageByRules(input(cleaned([], { too_short: 3 }, 3), "mindmap"))?.reason).toBe(
            "A mindmap with only a few words on it."
        );
    });
    it("leaves a real document to the model", () => {
        expect(triageByRules(input(cleaned([LONG])))).toBeNull();
    });
});

describe("triageSource", () => {
    it("asks the model with the organisation, the document and its opening, and keeps its reason", async () => {
        const generate = vi.fn(async () => ({
            role: "third_party" as const,
            reason: "A research paper by authors at the University of Washington — not about LaunchStack Dev.",
            subject: "dense retrieval granularity",
        }));
        const result = await triageSource(
            input(cleaned([LONG])),
            generate as unknown as GenerateStructuredFn
        );
        expect(result).toEqual({
            role: "third_party",
            roleBy: "model",
            reason: "A research paper by authors at the University of Washington — not about LaunchStack Dev.",
        });
        const call = generate.mock.calls[0] as unknown as [{ prompt: string }];
        expect(call[0].prompt).toContain("ORGANISATION: LaunchStack Dev");
        expect(call[0].prompt).toContain("LaunchStack is an open-source startup operating system");
    });
});

describe("openingOf", () => {
    it("takes the opening and one sample from later in a long document", () => {
        const text = openingOf(
            cleaned([...Array.from({ length: 12 }, (_, i) => `${"x".repeat(600)} part ${i}`)])
        );
        expect(text).toContain("part 0");
        expect(text).toContain("[… later in the document …]");
        expect(text.length).toBeLessThan(7_000);
    });
});

describe("sourceKindOf", () => {
    it("reads the provenance markers ingestion leaves", () => {
        expect(sourceKindOf({ creationKey: "mindmap:12", ocrMetadata: null })).toBe("mindmap");
        expect(sourceKindOf({ creationKey: null, ocrMetadata: { kind: "mindmap" } })).toBe(
            "mindmap"
        );
        expect(
            sourceKindOf({
                creationKey: "connector:gmail:abc",
                ocrMetadata: { connector: "gmail" },
            })
        ).toBe("gmail");
        expect(sourceKindOf({ creationKey: "website:https://acme.com", ocrMetadata: null })).toBe(
            "website"
        );
        expect(sourceKindOf({ creationKey: "upload:xyz", ocrMetadata: {} })).toBe("upload");
        expect(
            sourceKindOf({ creationKey: null, ocrMetadata: { connector: "agent-sessions" } })
        ).toBe("conversation");
    });
});
