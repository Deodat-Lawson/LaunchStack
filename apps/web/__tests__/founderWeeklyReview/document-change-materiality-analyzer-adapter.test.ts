jest.mock("~/lib/llm", () => {
    class LlmCapabilityUnavailableError extends Error {}
    return {
        generateStructuredWithMetadata: jest.fn(),
        LlmCapabilityUnavailableError,
    };
});

import {
    type DocumentChangeMaterialityAnalysisInput,
} from "@launchstack/features/founder-weekly-review";
import { generateStructuredWithMetadata } from "~/lib/llm";
import { z } from "zod";

import {
    ProviderDocumentChangeMaterialityAnalyzer,
    createConfiguredDocumentChangeMaterialityAnalyzer,
} from "~/server/founder-weekly-review/document-change-materiality-analyzer";

const mockGenerateStructuredWithMetadata = jest.mocked(generateStructuredWithMetadata);

const input: DocumentChangeMaterialityAnalysisInput = {
    groupId: "document_change_group:synthetic",
    documentTitle: "Synthetic plan",
    structurePath: "/ownership",
    structureTitle: "Ownership",
    deterministicCategory: "uncertain",
    deterministicConfidence: "uncertain",
    deterministicSignals: ["no_strong_deterministic_signal"],
    changes: [{
        changeType: "modified",
        previousExcerpt: "Product owns telemetry.",
        currentExcerpt: "Telemetry is owned by Product.",
        alignmentMethod: "structure_path",
    }],
};

describe("document-change materiality provider adapter", () => {
    const originalEnabled = process.env.FWR_DOCUMENT_CHANGE_MATERIALITY_ANALYZER_ENABLED;

    afterEach(() => {
        mockGenerateStructuredWithMetadata.mockReset();
        if (originalEnabled === undefined) delete process.env.FWR_DOCUMENT_CHANGE_MATERIALITY_ANALYZER_ENABLED;
        else process.env.FWR_DOCUMENT_CHANGE_MATERIALITY_ANALYZER_ENABLED = originalEnabled;
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
        expect(result.metadata).toEqual({ provider: "openai", model: "fixture-model", promptVersion: "document-change-materiality/v1" });
        expect(result.metadata).not.toHaveProperty("providerRequestId");
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
