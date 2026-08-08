jest.mock("~/lib/llm", () => {
    class LlmCapabilityUnavailableError extends Error {}
    return {
        generateStructuredWithMetadata: jest.fn(),
        LlmCapabilityUnavailableError,
        PROVIDERS: ["openai", "kimi", "anthropic", "google", "ollama"],
    };
});

import {
    type DocumentChangeMaterialityAnalysisInput,
} from "@launchstack/features/founder-weekly-review";
import { generateStructuredWithMetadata } from "~/lib/llm";
import { z } from "zod";

import {
    DOCUMENT_CHANGE_MATERIALITY_SYSTEM_PROMPT,
    ProviderDocumentChangeMaterialityAnalyzer,
    buildDocumentChangeMaterialityAnalyzerPrompt,
    createConfiguredDocumentChangeMaterialityAnalyzer,
} from "~/server/founder-weekly-review/document-change-materiality-analyzer";

const mockGenerateStructuredWithMetadata = jest.mocked(generateStructuredWithMetadata);

const input: DocumentChangeMaterialityAnalysisInput = {
    groupId: "document_change_group:synthetic",
    documentTitle: "Synthetic plan",
    structurePath: "/ownership",
    structureTitle: "Ownership",
    deterministicAssessment: {
        category: "uncertain",
        confidence: "uncertain",
        detectedSignals: ["no_strong_deterministic_signal"],
        confirmedFactualDeltas: [],
        equivalentFactualValues: [{
            kind: "ownership", previousValue: "product", currentValue: "product", relation: "equivalent", confidence: "strong",
        }],
        possibleSignals: [],
        groupShape: "modified",
        semanticRisk: "paraphrase_possible",
    },
    changes: [{
        changeType: "modified",
        previousExcerpt: "Product owns telemetry.",
        currentExcerpt: "Telemetry is owned by Product.",
        alignmentMethod: "structure_path",
    }],
};

describe("document-change materiality provider adapter", () => {
    const originalEnabled = process.env.FWR_DOCUMENT_CHANGE_MATERIALITY_ANALYZER_ENABLED;
    const originalProvider = process.env.FWR_DOCUMENT_CHANGE_MATERIALITY_ANALYZER_PROVIDER;

    afterEach(() => {
        mockGenerateStructuredWithMetadata.mockReset();
        if (originalEnabled === undefined) delete process.env.FWR_DOCUMENT_CHANGE_MATERIALITY_ANALYZER_ENABLED;
        else process.env.FWR_DOCUMENT_CHANGE_MATERIALITY_ANALYZER_ENABLED = originalEnabled;
        if (originalProvider === undefined) delete process.env.FWR_DOCUMENT_CHANGE_MATERIALITY_ANALYZER_PROVIDER;
        else process.env.FWR_DOCUMENT_CHANGE_MATERIALITY_ANALYZER_PROVIDER = originalProvider;
    });

    it("requires explicit production opt-in instead of treating credentials as consent", () => {
        delete process.env.FWR_DOCUMENT_CHANGE_MATERIALITY_ANALYZER_ENABLED;
        expect(createConfiguredDocumentChangeMaterialityAnalyzer()).toBeUndefined();
        expect(mockGenerateStructuredWithMetadata).not.toHaveBeenCalled();
        process.env.FWR_DOCUMENT_CHANGE_MATERIALITY_ANALYZER_ENABLED = "true";
        expect(createConfiguredDocumentChangeMaterialityAnalyzer()).toBeInstanceOf(ProviderDocumentChangeMaterialityAnalyzer);
    });

    it("uses bounded smallExtraction structured generation and returns safe metadata", async () => {
        mockGenerateStructuredWithMetadata.mockResolvedValue({
            object: { disposition: "non_material", category: "editorial_rewrite", summary: "Meaning is unchanged.", confidence: 0.94 },
            metadata: { provider: "openai", model: "fixture-model", capability: "smallExtraction", providerRequestId: "must-not-propagate" },
        });
        const result = await new ProviderDocumentChangeMaterialityAnalyzer().analyze(input);
        expect(mockGenerateStructuredWithMetadata).toHaveBeenCalledWith(expect.objectContaining({
            capability: "smallExtraction",
            schemaName: "document_change_materiality",
            timeoutMs: 15_000,
            maxOutputTokens: 512,
        }));
        expect(mockGenerateStructuredWithMetadata.mock.calls[0]![0].prompt).toContain("Product owns telemetry.");
        expect(result.metadata).toEqual({ provider: "openai", model: "fixture-model", promptVersion: "document-change-materiality/v2" });
        expect(result.metadata).not.toHaveProperty("providerRequestId");
    });

    it("defines the v2 task around underlying state, structural equivalence, mixed rewrites, and concise output", () => {
        expect(DOCUMENT_CHANGE_MATERIALITY_SYSTEM_PROMPT).toEqual(expect.stringContaining("underlying business state"));
        expect(DOCUMENT_CHANGE_MATERIALITY_SYSTEM_PROMPT).toEqual(expect.stringContaining("split or merged fragments"));
        expect(DOCUMENT_CHANGE_MATERIALITY_SYSTEM_PROMPT).toEqual(expect.stringContaining("one real factual delta"));
        expect(DOCUMENT_CHANGE_MATERIALITY_SYSTEM_PROMPT).toEqual(expect.stringContaining("at most 320 characters"));
        const prompt = buildDocumentChangeMaterialityAnalyzerPrompt(input);
        expect(prompt).toContain('"confirmedFactualDeltas":[]');
        expect(prompt).toContain('"equivalentFactualValues"');
        expect(prompt).toContain('"semanticRisk":"paraphrase_possible"');
    });

    it("routes only this analyzer to its explicitly configured provider", async () => {
        process.env.FWR_DOCUMENT_CHANGE_MATERIALITY_ANALYZER_ENABLED = "true";
        process.env.FWR_DOCUMENT_CHANGE_MATERIALITY_ANALYZER_PROVIDER = "kimi";
        mockGenerateStructuredWithMetadata.mockResolvedValue({
            object: { disposition: "non_material", category: "editorial_rewrite", summary: "Meaning is unchanged.", confidence: 0.94 },
            metadata: { provider: "kimi", model: "kimi-k2.6", capability: "smallExtraction" },
        });
        const analyzer = createConfiguredDocumentChangeMaterialityAnalyzer();
        await analyzer!.analyze(input);
        expect(mockGenerateStructuredWithMetadata).toHaveBeenCalledWith(expect.objectContaining({
            capability: "smallExtraction",
            forceProvider: "kimi",
        }));
    });

    it("rejects an invalid analyzer-specific provider before any request", () => {
        process.env.FWR_DOCUMENT_CHANGE_MATERIALITY_ANALYZER_ENABLED = "true";
        process.env.FWR_DOCUMENT_CHANGE_MATERIALITY_ANALYZER_PROVIDER = "other";
        expect(() => createConfiguredDocumentChangeMaterialityAnalyzer()).toThrow("FWR_DOCUMENT_CHANGE_MATERIALITY_ANALYZER_PROVIDER");
        expect(mockGenerateStructuredWithMetadata).not.toHaveBeenCalled();
    });

    it("maps provider failures to optional-unavailable fallback errors", async () => {
        mockGenerateStructuredWithMetadata.mockRejectedValue(new Error("rate limited"));
        await expect(new ProviderDocumentChangeMaterialityAnalyzer().analyze(input)).rejects.toEqual(
            expect.objectContaining({ code: "unavailable" }),
        );
    });

    it("distinguishes invalid structured output from provider unavailability", async () => {
        mockGenerateStructuredWithMetadata.mockRejectedValue(new z.ZodError([]));
        await expect(new ProviderDocumentChangeMaterialityAnalyzer().analyze(input)).rejects.toEqual(
            expect.objectContaining({ code: "invalid" }),
        );
    });
});
