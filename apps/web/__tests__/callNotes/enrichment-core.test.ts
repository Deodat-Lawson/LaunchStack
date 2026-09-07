import {
    CALL_NOTES_ENRICHMENT_SCHEMA_VERSION,
    EnrichedNoteProposalSchema,
    EnrichmentInputSchema,
} from "@launchstack/features/call-notes";
import { invokeStructured } from "@launchstack/core/llm";

import { resolveConfiguredChatModel } from "~/lib/models";
import { ConfiguredCallNotesEnrichmentModel } from "~/server/call-notes/enrichment-model";
import { buildCallNotesEnrichmentPrompt } from "~/server/call-notes/enrichment-prompts";
import {
    EnrichmentProvenanceValidationError,
    validateEnrichmentProvenance,
} from "~/server/call-notes/enrichment-validation";

jest.mock("@launchstack/core/llm", () => ({
    invokeStructured: jest.fn(),
}));

jest.mock("~/lib/models", () => ({
    resolveConfiguredChatModel: jest.fn(),
}));

const INPUT = EnrichmentInputSchema.parse({
    schemaVersion: CALL_NOTES_ENRICHMENT_SCHEMA_VERSION,
    callId: "call-a1",
    transcriptFingerprint: "a".repeat(64),
    transcript: [
        {
            id: "segment-customer",
            attemptId: "attempt-1",
            audioChannel: "system",
            participantId: "participant-customer",
            speakerName: "Maya Customer",
            sourceStartMs: 1_000,
            sourceEndMs: 4_000,
            receivedAt: "2026-08-15T14:00:04.100Z",
            receiveOrder: 1,
            text: "We need to reduce onboarding time before the September launch.",
            language: "en",
        },
        {
            id: "segment-owner",
            attemptId: "attempt-1",
            audioChannel: "microphone",
            participantId: "participant-owner",
            speakerName: "Alex Founder",
            sourceStartMs: 421_000,
            sourceEndMs: 425_000,
            receivedAt: "2026-08-15T14:07:05.050Z",
            receiveOrder: 2,
            text: "I will send the revised onboarding checklist by Friday.",
            language: "en",
        },
    ],
    gaps: [
        {
            id: "gap-paused",
            attemptId: "attempt-1",
            kind: "user_paused",
            startedAt: "2026-08-15T14:05:00.000Z",
            endedAt: "2026-08-15T14:07:00.000Z",
        },
    ],
    note: {
        documentNoteId: 41,
        ownerUserId: "user-owner",
        visibility: "private",
        knowledgeIncluded: false,
        revision: 3,
        title: "Owner's onboarding notes",
        contentMarkdown: "Onboarding takes too long.",
        contentRich: { type: "doc", attrs: { b: 2, a: 1 }, content: [] },
        saveState: "saved",
    },
});

const GROUNDED_PROPOSAL = EnrichedNoteProposalSchema.parse({
    schemaVersion: CALL_NOTES_ENRICHMENT_SCHEMA_VERSION,
    chronologicalSections: [
        {
            heading: "Onboarding launch risk",
            markdown: "**Onboarding needs to be faster** before the September launch.",
            ownerContextLabels: ["Owner noted onboarding concern"],
        },
    ],
    summary: "Onboarding time is a stated launch risk.",
    decisions: [],
    actionItems: [
        {
            text: "Send the revised onboarding checklist.",
            ownerName: "Alex Founder",
            dueDate: null,
        },
    ],
    conflicts: [],
});

function issueCodes(error: unknown): string[] {
    expect(error).toBeInstanceOf(EnrichmentProvenanceValidationError);
    return (error as EnrichmentProvenanceValidationError).issues.map(issue => issue.code);
}

describe("Call Notes enrichment prompt", () => {
    it("serializes equivalent input deterministically", () => {
        const reorderedRichTextInput = EnrichmentInputSchema.parse({
            ...INPUT,
            note: {
                ...INPUT.note,
                contentRich: { content: [], attrs: { a: 1, b: 2 }, type: "doc" },
            },
        });

        expect(buildCallNotesEnrichmentPrompt(INPUT)).toBe(
            buildCallNotesEnrichmentPrompt(reorderedRichTextInput)
        );
    });
});

describe("Call Notes enrichment input integrity", () => {
    it("accepts a proposal with unique Transcript segments and valid timestamp ranges", () => {
        expect(validateEnrichmentProvenance(INPUT, GROUNDED_PROPOSAL)).toEqual(GROUNDED_PROPOSAL);
    });

    it("rejects duplicate Transcript segment IDs", () => {
        const duplicateInput = EnrichmentInputSchema.parse({
            ...INPUT,
            transcript: [...INPUT.transcript, INPUT.transcript[0]!],
        });
        let thrown: unknown;
        try {
            validateEnrichmentProvenance(duplicateInput, GROUNDED_PROPOSAL);
        } catch (error) {
            thrown = error;
        }

        expect(issueCodes(thrown)).toContain("duplicate_transcript_segment_id");
    });

    it("rejects an invalid Transcript timestamp range", () => {
        const invalidRangeInput = EnrichmentInputSchema.parse({
            ...INPUT,
            transcript: INPUT.transcript.map(segment =>
                segment.id === "segment-customer"
                    ? { ...segment, sourceStartMs: 4_000, sourceEndMs: 1_000 }
                    : segment
            ),
        });
        let thrown: unknown;
        try {
            validateEnrichmentProvenance(invalidRangeInput, GROUNDED_PROPOSAL);
        } catch (error) {
            thrown = error;
        }

        expect(issueCodes(thrown)).toContain("invalid_transcript_timestamp_range");
    });
});

describe("ConfiguredCallNotesEnrichmentModel", () => {
    const resolveModelMock = resolveConfiguredChatModel as jest.Mock;
    const invokeStructuredMock = invokeStructured as jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        resolveModelMock.mockReturnValue({
            route: "reasoning",
            name: "configured-label",
            modelId: "configured-reasoning-model",
        });
        invokeStructuredMock.mockResolvedValue(GROUNDED_PROPOSAL);
    });

    it("generates a normal grounded enrichment without mutating its input", async () => {
        const before = structuredClone(INPUT);

        const result = await new ConfiguredCallNotesEnrichmentModel().generate(INPUT);

        expect(result.proposal).toEqual(GROUNDED_PROPOSAL);
        expect(INPUT).toEqual(before);
    });

    it("rejects structurally invalid model output", async () => {
        invokeStructuredMock.mockResolvedValue({
            schemaVersion: CALL_NOTES_ENRICHMENT_SCHEMA_VERSION,
            chronologicalSections: [],
        });

        await expect(new ConfiguredCallNotesEnrichmentModel().generate(INPUT)).rejects.toThrow();
    });

    it("propagates model exceptions without a persistence side effect", async () => {
        const failure = new Error("configured model timed out");
        invokeStructuredMock.mockRejectedValue(failure);

        await expect(new ConfiguredCallNotesEnrichmentModel().generate(INPUT)).rejects.toBe(
            failure
        );
    });
});
