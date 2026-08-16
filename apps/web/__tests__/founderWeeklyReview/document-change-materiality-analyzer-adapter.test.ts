jest.mock("~/lib/models", () => ({
    resolveConfiguredChatModel: jest.fn(),
}));
jest.mock("@launchstack/core/llm", () => ({
    invokeStructured: jest.fn(),
}));

import { invokeStructured } from "@launchstack/core/llm";
import type { DocumentChangeMaterialityAnalysisInput } from "@launchstack/features/founder-weekly-review";
import {
    DOCUMENT_CHANGE_MATERIALITY_ANALYZER_MAX_OUTPUT_TOKENS,
    DOCUMENT_CHANGE_MATERIALITY_ANALYZER_TIMEOUT_MS,
    DOCUMENT_CHANGE_MATERIALITY_SYSTEM_PROMPT,
    createConfiguredDocumentChangeMaterialityAnalyzer,
} from "~/server/founder-weekly-review/document-change-materiality-analyzer";
import { resolveConfiguredChatModel } from "~/lib/models";

const mockResolve = resolveConfiguredChatModel as jest.Mock;
const mockInvoke = invokeStructured as jest.Mock;

const input: DocumentChangeMaterialityAnalysisInput = {
    groupId: "group-1",
    documentTitle: "Plan",
    structurePath: "1",
    structureTitle: "Ownership",
    deterministicAssessment: {
        category: "uncertain",
        confidence: "uncertain",
        detectedSignals: [],
        confirmedFactualDeltas: [],
        equivalentFactualValues: [],
        possibleSignals: [],
        groupShape: "modified",
        semanticRisk: "paraphrase_possible",
    },
    changes: [
        {
            changeType: "modified",
            previousExcerpt: "Product owns retries.",
            currentExcerpt: "Platform owns retries.",
            alignmentMethod: "structure_path",
        },
    ],
};

describe("configured document-change materiality analyzer", () => {
    const originalEnabled = process.env.FWR_DOCUMENT_CHANGE_MATERIALITY_ANALYZER_ENABLED;

    afterEach(() => {
        jest.resetAllMocks();
        if (originalEnabled === undefined)
            delete process.env.FWR_DOCUMENT_CHANGE_MATERIALITY_ANALYZER_ENABLED;
        else process.env.FWR_DOCUMENT_CHANGE_MATERIALITY_ANALYZER_ENABLED = originalEnabled;
    });

    it("is opt-in and does not activate from credentials alone", () => {
        delete process.env.FWR_DOCUMENT_CHANGE_MATERIALITY_ANALYZER_ENABLED;
        expect(createConfiguredDocumentChangeMaterialityAnalyzer()).toBeUndefined();
    });

    it("uses the configured provider-neutral model seam with bounded output", async () => {
        process.env.FWR_DOCUMENT_CHANGE_MATERIALITY_ANALYZER_ENABLED = "true";
        mockResolve.mockReturnValue({ route: "default", name: "configured", modelId: "model" });
        mockInvoke.mockResolvedValue({
            disposition: "material",
            category: "ownership_change",
            summary: "Ownership changed from Product to Platform.",
            confidence: 0.95,
        });

        const analyzer = createConfiguredDocumentChangeMaterialityAnalyzer();
        await expect(analyzer!.analyze(input)).resolves.toMatchObject({
            result: { disposition: "material", category: "ownership_change" },
            metadata: { provider: "configured", model: "model" },
        });
        expect(mockResolve).toHaveBeenCalledWith({
            route: "default",
            timeoutMs: DOCUMENT_CHANGE_MATERIALITY_ANALYZER_TIMEOUT_MS,
            maxOutputTokens: DOCUMENT_CHANGE_MATERIALITY_ANALYZER_MAX_OUTPUT_TOKENS,
        });
        expect(DOCUMENT_CHANGE_MATERIALITY_SYSTEM_PROMPT).toContain(
            "did the underlying business state change"
        );
        expect(DOCUMENT_CHANGE_MATERIALITY_SYSTEM_PROMPT).toContain("at most 320 characters");
    });
});
