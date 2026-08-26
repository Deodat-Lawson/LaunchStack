import { describe, expect, it } from "vitest";
import { buildBrandVoiceMessages } from "@launchstack/tools/brand-voice";
import { buildPersonaMessages } from "@launchstack/tools/persona";

function textOf(message: unknown): string {
    return String((message as { content: unknown }).content);
}

describe("buildBrandVoiceMessages", () => {
    it("numbers the samples and omits the tone hint by default", () => {
        const [system, human] = buildBrandVoiceMessages({ snippets: ["alpha", "beta"] });
        expect(textOf(system)).toContain("brand voice analyst");
        expect(textOf(system)).not.toContain("has requested");
        expect(textOf(human)).toContain("1. alpha\n\n2. beta");
    });

    it("appends the tone override instruction when set", () => {
        const [system] = buildBrandVoiceMessages({ snippets: [], toneOverride: "bold" });
        expect(textOf(system)).toContain('Set formalityLevel to "bold"');
    });

    it("uses the no-samples sentinel when retrieval found nothing", () => {
        const [, human] = buildBrandVoiceMessages({ snippets: [] });
        expect(textOf(human)).toContain("No text samples available.");
    });
});

describe("buildPersonaMessages", () => {
    it("carries the audience description and the knowledge block", () => {
        const [system, human] = buildPersonaMessages({
            snippets: ["fact one"],
            targetAudience: "CTOs at mid-stage SaaS",
        });
        expect(textOf(system)).toContain("audience research analyst");
        expect(textOf(human)).toContain("Target audience: CTOs at mid-stage SaaS");
        expect(textOf(human)).toContain("1. fact one");
    });

    it("uses the no-data sentinel when retrieval found nothing", () => {
        const [, human] = buildPersonaMessages({ snippets: [], targetAudience: "anyone" });
        expect(textOf(human)).toContain("No persona-relevant data found in KB.");
    });
});
