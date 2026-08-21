import {
    CALL_NOTES_ENRICHMENT_SCHEMA_VERSION,
    EnrichedNoteProposalSchema,
    EnrichmentInputSchema,
    EnrichmentResultSchema,
    type EnrichedNoteProposal,
} from "@launchstack/features/call-notes";
import { invokeStructured } from "@launchstack/core/llm";

import { resolveConfiguredChatModel } from "~/lib/models";
import {
    CALL_NOTES_ENRICHMENT_ROUTE,
    ConfiguredCallNotesEnrichmentModel,
} from "~/server/call-notes/enrichment-model";
import {
    buildCallNotesEnrichmentPrompt,
    CALL_NOTES_ENRICHMENT_PROMPT_VERSION,
    CALL_NOTES_ENRICHMENT_SYSTEM_PROMPT,
} from "~/server/call-notes/enrichment-prompts";
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
            participantId: "participant-customer",
            speakerName: "Maya Customer",
            providerStartMs: 1_000,
            providerEndMs: 4_000,
            receivedAt: "2026-08-15T14:00:04.100Z",
            receiveOrder: 1,
            text: "We need to reduce onboarding time before the September launch.",
            language: "en",
        },
        {
            id: "segment-owner",
            attemptId: "attempt-1",
            participantId: "participant-owner",
            speakerName: "Alex Founder",
            providerStartMs: 421_000,
            providerEndMs: 425_000,
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
    bookmarks: [
        {
            id: "bookmark-customer",
            segmentId: "segment-customer",
            comment: "Emphasize this launch risk in the summary.",
            createdAt: "2026-08-15T14:00:05.000Z",
        },
    ],
    note: {
        documentNoteId: 41,
        ownerUserId: "user-owner",
        visibility: "private",
        knowledgeIncluded: false,
        revision: 3,
        title: "Owner's onboarding notes",
        contentMarkdown: "Customer is worried about onboarding time. Preserve my wording.",
        contentRich: { type: "doc", attrs: { b: 2, a: 1 }, content: [] },
        saveState: "saved",
    },
});

const GROUNDED_PROPOSAL = EnrichedNoteProposalSchema.parse({
    schemaVersion: CALL_NOTES_ENRICHMENT_SCHEMA_VERSION,
    chronologicalSections: [
        {
            heading: "Onboarding launch risk",
            markdown: "Maya needs onboarding time reduced before the September launch.",
            ownerContextLabels: ["Owner noted onboarding concern"],
        },
    ],
    summary: "Onboarding time is a stated launch risk.",
    actionItems: [
        {
            text: "Send the revised onboarding checklist.",
            ownerName: "Alex Founder",
            dueDate: null,
        },
    ],
    bookmarkPassages: [
        {
            markdown: "Maya identified onboarding time as a launch risk.",
            citations: [
                {
                    bookmarkId: "bookmark-customer",
                    segmentId: "segment-customer",
                    speakerName: "Maya Customer",
                    providerStartMs: 1_000,
                },
            ],
        },
    ],
    conflicts: [],
    contentMarkdown: "## Onboarding launch risk\nMaya needs onboarding time reduced.",
    contentRich: { type: "doc", content: [] },
});

function citationProposal(
    overrides: Partial<EnrichedNoteProposal["bookmarkPassages"][number]["citations"][number]> = {}
): EnrichedNoteProposal {
    const citation = GROUNDED_PROPOSAL.bookmarkPassages[0]!.citations[0]!;
    return EnrichedNoteProposalSchema.parse({
        ...GROUNDED_PROPOSAL,
        bookmarkPassages: [
            {
                ...GROUNDED_PROPOSAL.bookmarkPassages[0],
                citations: [{ ...citation, ...overrides }],
            },
        ],
    });
}

function issueCodes(error: unknown): string[] {
    expect(error).toBeInstanceOf(EnrichmentProvenanceValidationError);
    return (error as EnrichmentProvenanceValidationError).issues.map(issue => issue.code);
}

interface ParsedEnrichmentPrompt {
    promptVersion: string;
    outputSchemaVersion: string;
    generationMode: string;
    currentOwnerCallNote: {
        sourceRole: string;
        revision: number;
        contentMarkdown: string;
    };
    bookmarks: Array<{
        bookmarkId: string;
        linkedTranscriptSegmentId: string;
        userGuidance: string | null;
        guidanceRole: string;
    }>;
    transcriptGaps: Array<{
        id: string;
        evidenceAvailability: string;
        instruction: string;
    }>;
}

function parsePrompt(input = INPUT): ParsedEnrichmentPrompt {
    return JSON.parse(buildCallNotesEnrichmentPrompt(input)) as ParsedEnrichmentPrompt;
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

    it("labels the owner-authored note as source context and preserves its content", () => {
        const prompt = parsePrompt();

        expect(prompt.currentOwnerCallNote).toMatchObject({
            sourceRole: "owner-authored current Call Note",
            revision: 3,
            contentMarkdown: INPUT.note.contentMarkdown,
        });
    });

    it("represents Bookmark comments as strong user guidance, not evidence", () => {
        const prompt = parsePrompt();

        expect(prompt.bookmarks[0]).toMatchObject({
            bookmarkId: "bookmark-customer",
            linkedTranscriptSegmentId: "segment-customer",
            userGuidance: "Emphasize this launch risk in the summary.",
            guidanceRole: "strong user steering, not independent factual evidence",
        });
    });

    it("represents Transcript gaps explicitly as unavailable evidence", () => {
        const prompt = parsePrompt();

        expect(prompt.transcriptGaps[0]).toMatchObject({
            id: "gap-paused",
            evidenceAvailability: "unavailable",
            instruction: "Do not infer or reconstruct content during this gap.",
        });
    });

    it("prohibits ambiguous outcomes and inference across gaps", () => {
        expect(CALL_NOTES_ENRICHMENT_SYSTEM_PROMPT).toContain(
            "uncertain discussion, suggestions, questions, or possibilities"
        );
        expect(CALL_NOTES_ENRICHMENT_SYSTEM_PROMPT).toContain(
            "Never infer, reconstruct, summarize, or bridge content"
        );
        expect(CALL_NOTES_ENRICHMENT_SYSTEM_PROMPT).toContain(
            "Never invent decisions, action items, owners, deadlines"
        );
    });

    it("requests a separate proposal with the frozen version", () => {
        const prompt = parsePrompt();

        expect(prompt.promptVersion).toBe(CALL_NOTES_ENRICHMENT_PROMPT_VERSION);
        expect(prompt.outputSchemaVersion).toBe(CALL_NOTES_ENRICHMENT_SCHEMA_VERSION);
        expect(prompt.generationMode).toContain("separate proposal");
    });
});

describe("Call Notes enrichment provenance", () => {
    it("accepts a Bookmark citation copied exactly from canonical input", () => {
        expect(validateEnrichmentProvenance(INPUT, GROUNDED_PROPOSAL)).toEqual(GROUNDED_PROPOSAL);
    });

    it("rejects an invented Bookmark ID", () => {
        let thrown: unknown;
        try {
            validateEnrichmentProvenance(
                INPUT,
                citationProposal({ bookmarkId: "bookmark-invented" })
            );
        } catch (error) {
            thrown = error;
        }

        expect(issueCodes(thrown)).toContain("unknown_bookmark_id");
    });

    it("rejects an invented Transcript segment ID", () => {
        let thrown: unknown;
        try {
            validateEnrichmentProvenance(
                INPUT,
                citationProposal({ segmentId: "segment-invented" })
            );
        } catch (error) {
            thrown = error;
        }

        expect(issueCodes(thrown)).toContain("unknown_transcript_segment_id");
    });

    it("rejects a citation to a segment unrelated to its Bookmark", () => {
        let thrown: unknown;
        try {
            validateEnrichmentProvenance(
                INPUT,
                citationProposal({
                    segmentId: "segment-owner",
                    speakerName: "Alex Founder",
                    providerStartMs: 421_000,
                })
            );
        } catch (error) {
            thrown = error;
        }

        expect(issueCodes(thrown)).toContain("bookmark_segment_mismatch");
    });

    it("rejects a mismatched speaker identity", () => {
        let thrown: unknown;
        try {
            validateEnrichmentProvenance(
                INPUT,
                citationProposal({ speakerName: "Invented Speaker" })
            );
        } catch (error) {
            thrown = error;
        }

        expect(issueCodes(thrown)).toContain("speaker_mismatch");
    });

    it("rejects a mismatched citation timestamp", () => {
        let thrown: unknown;
        try {
            validateEnrichmentProvenance(INPUT, citationProposal({ providerStartMs: 999 }));
        } catch (error) {
            thrown = error;
        }

        expect(issueCodes(thrown)).toContain("timestamp_mismatch");
    });

    it("rejects a citation when its canonical segment has an invalid timestamp range", () => {
        const invalidRangeInput = EnrichmentInputSchema.parse({
            ...INPUT,
            transcript: INPUT.transcript.map(segment =>
                segment.id === "segment-customer"
                    ? { ...segment, providerStartMs: 4_000, providerEndMs: 1_000 }
                    : segment
            ),
        });
        let thrown: unknown;
        try {
            validateEnrichmentProvenance(
                invalidRangeInput,
                citationProposal({ providerStartMs: 4_000 })
            );
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

    it("resolves the configured reasoning route", async () => {
        await new ConfiguredCallNotesEnrichmentModel().generate(INPUT);

        expect(resolveModelMock).toHaveBeenCalledWith({ route: CALL_NOTES_ENRICHMENT_ROUTE });
        expect(invokeStructuredMock).toHaveBeenCalledWith(
            expect.objectContaining({ modelId: "configured-reasoning-model" }),
            EnrichedNoteProposalSchema,
            expect.any(Array),
            { name: "call_notes_enrichment_v1" }
        );
    });

    it("returns a final result that validates against the frozen schema", async () => {
        const result = await new ConfiguredCallNotesEnrichmentModel().generate(INPUT);

        expect(() => EnrichmentResultSchema.parse(result)).not.toThrow();
        expect(result.modelMetadata).toEqual({
            model: "configured-reasoning-model",
            promptVersion: CALL_NOTES_ENRICHMENT_PROMPT_VERSION,
        });
        expect(result.modelMetadata).not.toHaveProperty("provider");
        expect(result.modelMetadata).not.toHaveProperty("completionId");
    });
});
