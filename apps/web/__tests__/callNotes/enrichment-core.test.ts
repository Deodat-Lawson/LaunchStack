import {
    CALL_NOTES_ENRICHMENT_SCHEMA_VERSION,
    EnrichedNoteProposalSchema,
    EnrichmentInputSchema,
} from "@launchstack/pipelines/call-notes";
import { invokeStructured } from "@launchstack/llm";

import { resolveConfiguredChatModel, resolveConfiguredChatRoute } from "~/lib/models";
import { ConfiguredCallNotesEnrichmentModel } from "~/server/call-notes/enrichment-model";
import { buildCallNotesEnrichmentPrompt } from "~/server/call-notes/enrichment-prompts";
import {
    EnrichmentProvenanceValidationError,
    validateEnrichmentProvenance,
} from "~/server/call-notes/enrichment-validation";

jest.mock("@launchstack/llm", () => ({
    invokeStructured: jest.fn(),
}));

jest.mock("~/lib/models", () => ({
    resolveConfiguredChatModel: jest.fn(),
    resolveConfiguredChatRoute: jest.fn(),
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
        (resolveConfiguredChatRoute as jest.Mock).mockReturnValue({
            definition: { behavior: {} },
        });
        resolveModelMock.mockReturnValue({
            route: "reasoning",
            name: "configured-label",
            modelId: "configured-reasoning-model",
            behavior: {},
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

    it("bounds long requests, preserves ordered coverage, and keeps owner context separate", async () => {
        const input = EnrichmentInputSchema.parse({
            ...INPUT,
            transcript: Array.from({ length: 60 }, (_, index) => ({
                ...INPUT.transcript[0],
                id: `segment-${index}`,
                receiveOrder: index,
                text: `FACT_${index} ${"Discussion detail. ".repeat(100)}`,
            })),
            note: { ...INPUT.note, contentMarkdown: "OWNER_ONLY ".repeat(4_000) },
        });
        const before = structuredClone(input);
        let active = 0;
        let peak = 0;
        const covered: string[] = [];
        let finalPrompt:
            | {
                  finalizedTranscript: { summaries: string[] };
                  currentOwnerCallNote: { body: string[] };
              }
            | undefined;
        invokeStructuredMock.mockImplementation(async (_model, _schema, messages, options) => {
            expect(
                Buffer.byteLength(
                    messages.map((message: { content: string }) => message.content).join("")
                )
            ).toBeLessThanOrEqual(24_000);
            const prompt = JSON.parse(messages[1].content);
            if (options.name === "call_notes_enrichment_v1") {
                expect(active).toBe(0);
                finalPrompt = prompt;
                return GROUNDED_PROPOSAL;
            }
            active += 1;
            peak = Math.max(peak, active);
            const text = prompt.excerpts.join("\n");
            await Promise.resolve();
            if (text.includes("FACT_0 ")) await Promise.resolve();
            active -= 1;
            if (prompt.source === "owner_note") {
                expect(text).not.toContain("FACT_");
                return { summary: "OWNER_ONLY" };
            }
            expect(text).not.toContain("OWNER_ONLY");
            const facts = text.match(/FACT_\d+/g) ?? [];
            covered.push(...facts);
            return { summary: facts.length ? facts.join(" ") : "Known transcript gap." };
        });

        await new ConfiguredCallNotesEnrichmentModel().generate(input);

        const expected = input.transcript.map((_, index) => `FACT_${index}`);
        expect(covered.sort()).toEqual([...expected].sort());
        expect(finalPrompt!.finalizedTranscript.summaries.join(" ").match(/FACT_\d+/g)).toEqual(
            expected
        );
        expect(finalPrompt!.currentOwnerCallNote.body.join(" ")).toContain("OWNER_ONLY");
        expect(peak).toBe(2);
        expect(input).toEqual(before);
    });

    it("reduces summaries again when their combined size exceeds the final budget", async () => {
        const input = EnrichmentInputSchema.parse({
            ...INPUT,
            transcript: Array.from({ length: 80 }, (_, index) => ({
                ...INPUT.transcript[0],
                id: `segment-${index}`,
                text: `FACT_${index} ${"word ".repeat(3_800)}`,
            })),
        });
        let reducedSummaries = false;
        let finalFacts: string[] = [];
        invokeStructuredMock.mockImplementation(async (_model, _schema, messages, options) => {
            expect(
                Buffer.byteLength(
                    messages.map((message: { content: string }) => message.content).join("")
                )
            ).toBeLessThanOrEqual(24_000);
            const prompt = JSON.parse(messages[1].content);
            if (options.name === "call_notes_enrichment_v1") {
                finalFacts = prompt.finalizedTranscript.summaries.join(" ").match(/FACT_\d+/g);
                return GROUNDED_PROPOSAL;
            }
            const text = prompt.excerpts.join("\n");
            if (!text.includes("segmentId")) reducedSummaries = true;
            return {
                summary: `${(text.match(/FACT_\d+/g) ?? []).join(" ")} ${"detail ".repeat(150)}`,
            };
        });

        await new ConfiguredCallNotesEnrichmentModel().generate(input);

        expect(reducedSummaries).toBe(true);
        expect(finalFacts).toEqual(input.transcript.map((_, index) => `FACT_${index}`));
    });

    it("splits oversized Unicode segments without losing text or speaker attribution", async () => {
        const text = "你好世界🌍".repeat(3_000);
        const input = EnrichmentInputSchema.parse({
            ...INPUT,
            transcript: [{ ...INPUT.transcript[0], text }],
            gaps: [],
        });
        const fragments: string[] = [];
        invokeStructuredMock.mockImplementation(async (_model, _schema, messages, options) => {
            expect(
                Buffer.byteLength(
                    messages.map((message: { content: string }) => message.content).join("")
                )
            ).toBeLessThanOrEqual(24_000);
            if (options.name === "call_notes_enrichment_v1") return GROUNDED_PROPOSAL;
            const prompt = JSON.parse(messages[1].content);
            for (const excerpt of prompt.excerpts as string[]) {
                const boundary = excerpt.indexOf("\n");
                expect(JSON.parse(excerpt.slice(0, boundary)).speaker).toBe("Maya Customer");
                const fragment = excerpt.slice(boundary + 1);
                expect(Buffer.from(fragment, "utf8").toString("utf8")).toBe(fragment);
                fragments.push(fragment);
            }
            return { summary: "Discussion in Chinese." };
        });

        await new ConfiguredCallNotesEnrichmentModel().generate(input);

        expect(fragments.join("")).toBe(text);
    });

    it("stops after a failed summary wave without composing partial evidence", async () => {
        const input = EnrichmentInputSchema.parse({
            ...INPUT,
            transcript: Array.from({ length: 10 }, (_, index) => ({
                ...INPUT.transcript[0],
                id: `segment-${index}`,
                text: "evidence ".repeat(2_000),
            })),
        });
        const failure = new Error("Provider rate limit");
        let summaries = 0;
        let finalCalls = 0;
        invokeStructuredMock.mockImplementation(async (_model, _schema, _messages, options) => {
            if (options.name === "call_notes_enrichment_v1") finalCalls += 1;
            else summaries += 1;
            throw failure;
        });

        await expect(new ConfiguredCallNotesEnrichmentModel().generate(input)).rejects.toBe(
            failure
        );
        expect(summaries).toBe(2);
        expect(finalCalls).toBe(0);
    });

    it("honors smaller declared contexts instead of relying on the default budget", async () => {
        resolveModelMock.mockReturnValue({
            route: "reasoning",
            name: "small-context",
            modelId: "small-context",
            behavior: { limits: { contextTokens: 16_384 } },
        });
        const input = EnrichmentInputSchema.parse({
            ...INPUT,
            transcript: [{ ...INPUT.transcript[0], text: "context ".repeat(2_000) }],
        });
        invokeStructuredMock.mockImplementation(async (_model, _schema, messages, options) => {
            const promptBytes = Buffer.byteLength(
                messages.map((message: { content: string }) => message.content).join("")
            );
            expect(promptBytes).toBeLessThanOrEqual(16_384 - 4_096 - 4_096);
            return options.name === "call_notes_enrichment_v1"
                ? GROUNDED_PROPOSAL
                : { summary: "Onboarding context." };
        });

        await new ConfiguredCallNotesEnrichmentModel().generate(input);
    });

    it("rejects oversized summaries rather than truncating evidence or sending an oversized final request", async () => {
        const input = EnrichmentInputSchema.parse({
            ...INPUT,
            transcript: [{ ...INPUT.transcript[0], text: "detail ".repeat(2_800) }],
        });
        let finalCalls = 0;
        invokeStructuredMock.mockImplementation(async (_model, _schema, _messages, options) => {
            if (options.name === "call_notes_enrichment_v1") finalCalls += 1;
            return { summary: "膨".repeat(1_800) };
        });

        await expect(new ConfiguredCallNotesEnrichmentModel().generate(input)).rejects.toThrow(
            "Summary exceeds its encoded byte budget"
        );
        expect(finalCalls).toBe(0);
    });
});
