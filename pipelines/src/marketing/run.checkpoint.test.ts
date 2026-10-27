/**
 * The checkpoint port: a stage that succeeded is saved, and a retry restores
 * it instead of calling its model again — so a run that dies at the last
 * stage redoes one stage, not ten. A degradable stage's fallback is never
 * saved (it deserves another try), and a restored stage still reports
 * completed to the screen.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Record<string, number> = {};
const count = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
};
let failVoice = false;
let failClaims = false;
let failGenerateOnce = false;

vi.mock("@launchstack/tools/company-context", async importOriginal => ({
    ...(await importOriginal<object>()),
    getCompanyIdentity: async () => ({
        data: { name: "Roastery", industry: "Coffee", categories: ["beans"] },
    }),
    formatCompanyIdentity: () => "Roastery — coffee",
    buildCompanyKnowledgeContext: async () => (count("context"), "We roast light.\nOrigin first."),
    extractCompanyDNA: async () => (
        count("dna"),
        {
            dna: {
                coreMission: "Better coffee",
                keyDifferentiators: ["light roast"],
                provenResults: [],
                humanStory: "",
                technicalEdge: "small batches",
            },
            debug: { source: "rag", contextUsed: "", dna: {} },
        }
    ),
}));
vi.mock("@launchstack/tools/brand-voice", async importOriginal => ({
    ...(await importOriginal<object>()),
    extractBrandVoice: async () => {
        count("voice");
        if (failVoice) throw new Error("voice model down");
        return {
            toneDescriptor: "warm",
            formalityLevel: "casual",
            sentenceStyle: "short",
            vocabularyExamples: [],
        };
    },
}));
vi.mock("@launchstack/tools/persona", async importOriginal => ({
    ...(await importOriginal<object>()),
    extractTargetPersona: async () => (count("persona"), { role: "x" }),
}));
vi.mock("@launchstack/tools/claim-evidence", async importOriginal => ({
    ...(await importOriginal<object>()),
    checkClaimSources: async () => {
        count("claims");
        if (failClaims) throw new Error("claims timed out");
        return { claims: [], totalClaimsFound: 0 };
    },
}));
vi.mock("@launchstack/tools/platform-profiles", async importOriginal => ({
    ...(await importOriginal<object>()),
    getPlatformProfile: () => ({ guidelines: () => "Keep it short." }),
}));
vi.mock("@launchstack/tools/content-scoring", async importOriginal => ({
    ...(await importOriginal<object>()),
    rankVariants: vi.fn(),
}));
vi.mock("./competitor", () => ({
    analyzeCompetitors: async () => (
        count("competitors"),
        { competitors: [], ourAdvantages: [], marketGaps: [] }
    ),
}));
vi.mock("./research", () => ({
    researchPlatformTrends: async () => (count("trends"), []),
}));
vi.mock("./performance", () => ({
    getPerformanceHistory: async () => (count("performance"), []),
    buildPerformanceInsights: () => [],
    saveGeneratedContent: async () => undefined,
}));
vi.mock("./positioning", () => ({
    buildMultiStrategy: async () => (
        count("strategy"),
        [{ variantId: "v1", angle: "origin", angleRationale: "r", keyProof: "p" }]
    ),
}));
vi.mock("./generator", () => ({
    generateVariants: async () => {
        count("generate");
        if (failGenerateOnce) {
            failGenerateOnce = false;
            throw new Error("timeout");
        }
        return [{ variantId: "v1", message: "Light roast, origin first.", mediaType: "image" }];
    },
}));

import { runMarketingPipeline, type StageCheckpoint } from "./run";
import type { PipelineProgressEvent } from "@launchstack/tools/contract";

function memoryCheckpoint(): StageCheckpoint & { saved: Record<string, unknown> } {
    const saved: Record<string, unknown> = {};
    return {
        saved,
        get: step => saved[step],
        put: async (step, value) => {
            // What the jsonb column would hand back.
            saved[step] = JSON.parse(JSON.stringify(value));
        },
    };
}

const input = { platform: "linkedin" as const, prompt: "Announce our new roast" };

beforeEach(() => {
    for (const key of Object.keys(calls)) delete calls[key];
    failVoice = false;
    failClaims = false;
    failGenerateOnce = false;
});

describe("checkpointed stages", () => {
    it("saves every stage that succeeded", async () => {
        const checkpoint = memoryCheckpoint();
        const result = await runMarketingPipeline({ companyId: 1, input, checkpoint });
        expect(result.message).toBe("Light roast, origin first.");
        expect(Object.keys(checkpoint.saved).sort()).toEqual(
            [
                "loading-context",
                "extracting-dna",
                "analyzing-competitors",
                "researching-trends",
                "extracting-voice",
                "checking-performance",
                "building-strategy",
                "generating-content",
                "verifying-claims",
            ].sort()
        );
    });

    it("a retry after the last stage failed redoes only that stage", async () => {
        const checkpoint = memoryCheckpoint();
        // First attempt: everything up to generation succeeds, then the run dies
        // (the claim check is degradable, so generation is the required casualty).
        failGenerateOnce = true;
        await expect(runMarketingPipeline({ companyId: 1, input, checkpoint })).rejects.toThrow(
            "timeout"
        );
        expect(checkpoint.saved["building-strategy"]).toBeDefined();
        expect(checkpoint.saved["generating-content"]).toBeUndefined();

        for (const key of Object.keys(calls)) delete calls[key];
        const events: PipelineProgressEvent<string>[] = [];
        const result = await runMarketingPipeline({
            companyId: 1,
            input,
            checkpoint,
            onProgress: e => events.push(e),
        });
        expect(result.message).toBe("Light roast, origin first.");
        // Nothing before generation called its model again.
        expect(calls).toEqual({ generate: 1, claims: 1 });
        // …and the screen still saw every stage complete.
        const completed = events
            .filter(e => e.type === "step_complete")
            .map(e => (e as { step: string }).step);
        expect(completed).toContain("extracting-dna");
        expect(completed).toContain("building-strategy");
    });

    it("never saves a degradable stage's fallback, so a retry tries it again", async () => {
        const checkpoint = memoryCheckpoint();
        failVoice = true;
        await runMarketingPipeline({ companyId: 1, input, checkpoint });
        expect(checkpoint.saved["extracting-voice"]).toBeUndefined();

        failVoice = false;
        for (const key of Object.keys(calls)) delete calls[key];
        await runMarketingPipeline({ companyId: 1, input, checkpoint });
        expect(calls.voice).toBe(1);
        expect(checkpoint.saved["extracting-voice"]).toMatchObject({ toneDescriptor: "warm" });
    });

    it("runs exactly as before without a checkpoint", async () => {
        await runMarketingPipeline({ companyId: 1, input });
        await runMarketingPipeline({ companyId: 1, input });
        expect(calls.dna).toBe(2);
        expect(calls.generate).toBe(2);
    });
});
