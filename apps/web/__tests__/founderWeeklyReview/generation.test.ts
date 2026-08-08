jest.mock("~/lib/llm", () => ({
    generateStructuredWithMetadata: jest.fn(),
}));

import {
    FOUNDER_WEEKLY_REVIEW_V2_SCHEMA_VERSION,
    FounderWeeklyReviewV2PayloadSchema,
    buildFounderWeeklyReviewPrompt,
    generateFounderWeeklyReview,
    parseFounderWeeklyReviewPayload,
    type FounderWeeklyReviewEvidenceSnapshot,
    type FounderWeeklyReviewV2Payload,
} from "@launchstack/features/founder-weekly-review";
import { FounderWeeklyReviewGenerationValidationError } from "@launchstack/features/founder-weekly-review";
import { generateFounderWeeklyReviewStructured } from "~/server/founder-weekly-review/generation-adapter";
import { generateStructuredWithMetadata } from "~/lib/llm";

const mockGenerateStructuredWithMetadata = generateStructuredWithMetadata as jest.Mock;

function snapshot(items: FounderWeeklyReviewEvidenceSnapshot["items"]): FounderWeeklyReviewEvidenceSnapshot {
    return {
        schemaVersion: "founder-weekly-review-evidence/v1",
        capturedAt: "2026-07-18T10:00:00.000Z",
        reportingPeriod: { start: "2026-07-07", end: "2026-07-13" },
        workspaceTimezone: "UTC",
        items,
        sourceWarnings: [],
    };
}

const source = (sourceId: string, sourceType: FounderWeeklyReviewEvidenceSnapshot["items"][number]["sourceType"], excerpt = "Evidence excerpt", metadata: Record<string, string | number | boolean | (string | number | boolean | null)[] | null> = {}) => ({
    sourceId,
    sourceType,
    title: `${sourceType} title`,
    excerpt,
    metadata,
});

function noEvidence(message = "No evidence", cta = "Add evidence") {
    return { state: "no_evidence" as const, noEvidence: { code: "no_relevant_evidence", message, cta } };
}

function validPayload(): FounderWeeklyReviewV2Payload {
    return {
        schemaVersion: FOUNDER_WEEKLY_REVIEW_V2_SCHEMA_VERSION,
        sections: {
            whatChanged: { state: "evidence", items: [{ kind: "observed_fact", text: "The plan changed.", sourceIds: ["doc-1"], confidence: 0 }] },
            whatShipped: { state: "evidence", items: [{ kind: "observed_fact", text: "A release shipped.", sourceIds: ["doc-1"], confidence: 1 }] },
            whatCustomersSaid: { state: "evidence", items: [{ kind: "observed_fact", text: "A customer requested audit logs.", sourceIds: ["feedback-1"], confidence: 0.5 }] },
            currentBlockers: { state: "evidence", items: [{ kind: "observed_fact", text: "SSO remains blocked.", sourceIds: ["context-1"], confidence: 0.8 }] },
            nextPriorities: { state: "evidence", items: [{ kind: "recommendation", label: "Recommendation", text: "Prioritize SSO.", sourceIds: ["context-1"], confidence: 0.8, rationale: null }] },
        },
    };
}

function fake(object: unknown, metadata = { provider: "openai", model: "test-model", capability: "founderWeeklyReview", temperature: 0 }) {
    return jest.fn().mockResolvedValue({ object, metadata });
}

const completeSnapshot = () => snapshot([
    source("doc-1", "document_change", "A release shipped."),
    source("feedback-1", "customer_feedback", "Please add audit logs."),
    source("context-1", "founder_context", "SSO remains blocked."),
]);

describe("Founder Weekly Review generation", () => {
    it("generates complete evidence with numeric lower and upper confidence bounds", async () => {
        const generate = fake(validPayload());
        const result = await generateFounderWeeklyReview({ evidenceSnapshot: completeSnapshot(), generate });
        expect(result.reviewPayload).toEqual(validPayload());
        expect(result.modelMetadata).toMatchObject({ provider: "openai", temperature: 0, capability: "founderWeeklyReview" });
        expect(result.modelMetadata.promptHash).toMatch(/^[a-f0-9]{64}$/);
        expect(generate).toHaveBeenCalledTimes(1);
        expect(generate.mock.calls[0][0]).toMatchObject({ generationPhase: "initial" });
    });

    it("performs exactly one semantic repair against the same immutable snapshot", async () => {
        const invalid = validPayload();
        invalid.sections.whatCustomersSaid = {
            state: "evidence",
            items: [{ kind: "observed_fact", text: "Founder direction was presented as customer feedback.", sourceIds: ["context-1"], confidence: 0.5 }],
        };
        const repaired = validPayload();
        const generate = jest.fn()
            .mockResolvedValueOnce({ object: invalid, metadata: { provider: "kimi", model: "kimi-k2.6", capability: "founderWeeklyReview" } })
            .mockResolvedValueOnce({ object: repaired, metadata: { provider: "kimi", model: "kimi-k2.6", capability: "founderWeeklyReview" } });
        const evidenceSnapshot = completeSnapshot();

        await expect(generateFounderWeeklyReview({ evidenceSnapshot, generate })).resolves.toMatchObject({ reviewPayload: repaired });

        expect(generate).toHaveBeenCalledTimes(2);
        expect(generate.mock.calls[0][0]).toMatchObject({ generationPhase: "initial" });
        expect(generate.mock.calls[1][0]).toMatchObject({ generationPhase: "semantic-repair" });
        expect(generate.mock.calls[1][0].prompt).toContain("founder_context is founder-provided direction, not customer testimony.");
        expect(generate.mock.calls[1][0].prompt).toContain("context-1");
        expect(evidenceSnapshot).toEqual(completeSnapshot());
    });

    it("fails normally after one invalid semantic repair and never makes a third call", async () => {
        const invalid = validPayload();
        invalid.sections.whatCustomersSaid = {
            state: "evidence",
            items: [{ kind: "observed_fact", text: "Invalid customer claim.", sourceIds: ["context-1"], confidence: 0.5 }],
        };
        const generate = jest.fn()
            .mockResolvedValueOnce({ object: invalid, metadata: { provider: "kimi", model: "kimi-k2.6", capability: "founderWeeklyReview" } })
            .mockResolvedValueOnce({ object: invalid, metadata: { provider: "kimi", model: "kimi-k2.6", capability: "founderWeeklyReview" } });

        await expect(generateFounderWeeklyReview({ evidenceSnapshot: completeSnapshot(), generate })).rejects.toMatchObject({
            name: "FounderWeeklyReviewGenerationValidationError",
        });
        expect(generate).toHaveBeenCalledTimes(2);
    });

    it("does not semantic-repair provider failures", async () => {
        const generate = jest.fn().mockRejectedValue(new Error("provider unavailable"));
        await expect(generateFounderWeeklyReview({ evidenceSnapshot: completeSnapshot(), generate })).rejects.toThrow("provider unavailable");
        expect(generate).toHaveBeenCalledTimes(1);
    });

    it("allows partial reviews with typed no-evidence sections", async () => {
        const payload = validPayload();
        payload.sections.whatShipped = noEvidence();
        payload.sections.whatCustomersSaid = noEvidence();
        const result = await generateFounderWeeklyReview({ evidenceSnapshot: completeSnapshot(), generate: fake(payload) });
        expect(result.reviewPayload.sections.whatShipped.state).toBe("no_evidence");
    });

    it("preserves contradictory evidence rather than resolving it", async () => {
        const payload = validPayload();
        payload.sections.currentBlockers = { state: "evidence", items: [{ kind: "contradictory_evidence", text: "The blocker status conflicts.", sourceIds: ["doc-1", "context-1"], confidence: 0.6 }] };
        const result = await generateFounderWeeklyReview({ evidenceSnapshot: completeSnapshot(), generate: fake(payload) });
        expect(result.reviewPayload.sections.currentBlockers).toMatchObject({ state: "evidence", items: [{ kind: "contradictory_evidence" }] });
    });

    it("returns deterministic empty states and performs zero LLM calls for an empty snapshot", async () => {
        const generate = fake(validPayload());
        const result = await generateFounderWeeklyReview({ evidenceSnapshot: snapshot([]), generate });
        expect(generate).not.toHaveBeenCalled();
        expect(result.reviewPayload.sections.nextPriorities).toMatchObject({ state: "no_evidence" });
        expect(result.modelMetadata).toMatchObject({ provider: "skipped", model: "none", attributes: { generationSkipped: true } });
        for (const section of Object.values(result.reviewPayload.sections)) {
            expect(section.state).toBe("no_evidence");
            if (section.state === "no_evidence") {
                expect(section.noEvidence.cta.trim()).not.toBe("");
            }
        }
    });

    it.each([
        ["unknown generated source ID", (p: FounderWeeklyReviewV2Payload) => { p.sections.whatChanged = { state: "evidence", items: [{ kind: "observed_fact", text: "x", sourceIds: ["missing"], confidence: 0.5 }] }; }],
        ["duplicate generated citations", (p: FounderWeeklyReviewV2Payload) => { p.sections.whatChanged = { state: "evidence", items: [{ kind: "observed_fact", text: "x", sourceIds: ["doc-1", "doc-1"], confidence: 0.5 }] }; }],
        ["customer section citing document_change", (p: FounderWeeklyReviewV2Payload) => { p.sections.whatCustomersSaid = { state: "evidence", items: [{ kind: "observed_fact", text: "x", sourceIds: ["doc-1"], confidence: 0.5 }] }; }],
        ["customer section citing founder_context", (p: FounderWeeklyReviewV2Payload) => { p.sections.whatCustomersSaid = { state: "evidence", items: [{ kind: "observed_fact", text: "x", sourceIds: ["context-1"], confidence: 0.5 }] }; }],
        ["contradiction with fewer than two citations", (p: FounderWeeklyReviewV2Payload) => { p.sections.currentBlockers = { state: "evidence", items: [{ kind: "contradictory_evidence", text: "x", sourceIds: ["doc-1"], confidence: 0.5 }] }; }],
        ["recommendation outside nextPriorities", (p: FounderWeeklyReviewV2Payload) => { p.sections.whatChanged = { state: "evidence", items: [{ kind: "recommendation", label: "Recommendation", text: "x", sourceIds: ["doc-1"], confidence: 0.5 }] } as never; }],
    ])("rejects %s", async (_name, mutate) => {
        const payload = validPayload();
        mutate(payload);
        await expect(generateFounderWeeklyReview({ evidenceSnapshot: completeSnapshot(), generate: fake(payload) })).rejects.toBeInstanceOf(Error);
    });

    it.each(["whatChanged", "whatShipped"] as const)("rejects workspace_document-only %s claims", async (sectionName) => {
        const payload = validPayload();
        payload.sections[sectionName] = { state: "evidence", items: [{ kind: "observed_fact", text: "Current document implies a weekly event.", sourceIds: ["workspace-1"], confidence: 0.5 }] };
        await expect(generateFounderWeeklyReview({ evidenceSnapshot: snapshot([source("workspace-1", "workspace_document")]), generate: fake(payload) })).rejects.toBeInstanceOf(FounderWeeklyReviewGenerationValidationError);
    });

    it.each(["whatChanged", "whatShipped"] as const)("allows document_change plus workspace_document in %s", async (sectionName) => {
        const payload = validPayload();
        payload.sections[sectionName] = { state: "evidence", items: [{ kind: "observed_fact", text: "A dated change has current context.", sourceIds: ["doc-1", "workspace-1"], confidence: 0.5 }] };
        await expect(generateFounderWeeklyReview({ evidenceSnapshot: snapshot([...completeSnapshot().items, source("workspace-1", "workspace_document")]), generate: fake(payload) })).resolves.toBeDefined();
    });

    it("allows workspace_document for blockers and priorities while customer-only enforcement remains", async () => {
        const payload = validPayload();
        payload.sections.currentBlockers = { state: "evidence", items: [{ kind: "observed_fact", text: "Current context", sourceIds: ["workspace-1"], confidence: 0.5 }] };
        payload.sections.nextPriorities = { state: "evidence", items: [{ kind: "recommendation", label: "Recommendation", text: "Act on current context", sourceIds: ["workspace-1"], confidence: 0.5, rationale: null }] };
        await expect(generateFounderWeeklyReview({ evidenceSnapshot: snapshot([...completeSnapshot().items, source("workspace-1", "workspace_document")]), generate: fake(payload) })).resolves.toBeDefined();
    });

    it("rejects duplicate input source IDs before calling the model", async () => {
        const generate = fake(validPayload());
        await expect(generateFounderWeeklyReview({ evidenceSnapshot: snapshot([source("same", "manual_note"), source("same", "document_change")]), generate })).rejects.toBeInstanceOf(FounderWeeklyReviewGenerationValidationError);
        expect(generate).not.toHaveBeenCalled();
    });

    it("enforces numeric confidence bounds", () => {
        const payload = validPayload();
        payload.sections.whatChanged = { state: "evidence", items: [{ kind: "observed_fact", text: "x", sourceIds: ["doc-1"], confidence: -0.01 }] };
        expect(FounderWeeklyReviewV2PayloadSchema.safeParse(payload).success).toBe(false);
        (payload.sections.whatChanged as { state: "evidence"; items: Array<{ confidence: number }> }).items[0]!.confidence = 1.01;
        expect(FounderWeeklyReviewV2PayloadSchema.safeParse(payload).success).toBe(false);
    });

    it("rejects mixed v2 section states instead of normalizing them", () => {
        const payload = validPayload();
        payload.sections.whatChanged = {
            state: "evidence",
            items: [{ kind: "observed_fact", text: "x", sourceIds: ["doc-1"], confidence: 0.5 }],
            noEvidence: { code: "no_relevant_evidence", message: "x", cta: "x" },
        } as never;
        expect(FounderWeeklyReviewV2PayloadSchema.safeParse(payload).success).toBe(false);

        payload.sections.whatChanged = {
            state: "no_evidence",
            noEvidence: { code: "no_relevant_evidence", message: "x", cta: "x" },
            items: [{ kind: "observed_fact", text: "x", sourceIds: ["doc-1"], confidence: 0.5 }],
        } as never;
        expect(FounderWeeklyReviewV2PayloadSchema.safeParse(payload).success).toBe(false);
    });

    it("rejects observed facts in nextPriorities", () => {
        const payload = validPayload();
        payload.sections.nextPriorities = {
            state: "evidence",
            items: [{ kind: "observed_fact", text: "x", sourceIds: ["doc-1"], confidence: 0.5 }],
        } as never;
        expect(FounderWeeklyReviewV2PayloadSchema.safeParse(payload).success).toBe(false);
    });

    it("does not allow source warnings to be cited", async () => {
        const evidenceSnapshot = completeSnapshot();
        evidenceSnapshot.sourceWarnings = [{ code: "warning-1", message: "Missing source", sourceType: "github_activity" }];
        const payload = validPayload();
        payload.sections.whatChanged = { state: "evidence", items: [{ kind: "observed_fact", text: "x", sourceIds: ["warning-1"], confidence: 0.5 }] };
        await expect(generateFounderWeeklyReview({ evidenceSnapshot, generate: fake(payload) })).rejects.toBeInstanceOf(Error);
    });

    it("puts anti-invention requirements in the prompt and hashes a fixed fixture stably", async () => {
        const generateA = fake(validPayload());
        const generateB = fake(validPayload());
        const first = await generateFounderWeeklyReview({ evidenceSnapshot: completeSnapshot(), generate: generateA });
        const second = await generateFounderWeeklyReview({ evidenceSnapshot: completeSnapshot(), generate: generateB });
        expect(generateA.mock.calls[0][0].system).toContain("Never invent");
        expect(generateA.mock.calls[0][0].system).toContain("whatCustomersSaid may cite only customer_feedback");
        for (const prohibitedFact of ["customers", "people", "dates", "metrics", "shipped work", "blockers", "outcomes", "source IDs"]) {
            expect(generateA.mock.calls[0][0].system).toContain(prohibitedFact);
        }
        expect(first.modelMetadata.promptHash).toBe(second.modelMetadata.promptHash);
    });

    it("canonicalizes metadata key order before building the prompt and hash", async () => {
        const firstSnapshot = completeSnapshot();
        firstSnapshot.items[0]!.metadata = { alpha: "a", beta: "b" };
        const secondSnapshot = completeSnapshot();
        secondSnapshot.items[0]!.metadata = { beta: "b", alpha: "a" };
        expect(buildFounderWeeklyReviewPrompt(firstSnapshot)).toBe(buildFounderWeeklyReviewPrompt(secondSnapshot));

        const first = await generateFounderWeeklyReview({ evidenceSnapshot: firstSnapshot, generate: fake(validPayload()) });
        const second = await generateFounderWeeklyReview({ evidenceSnapshot: secondSnapshot, generate: fake(validPayload()) });
        expect(first.modelMetadata.promptHash).toBe(second.modelMetadata.promptHash);
    });

    it("adapts the configured web abstraction and returns its metadata", async () => {
        mockGenerateStructuredWithMetadata.mockResolvedValue({ object: { ok: true }, metadata: { provider: "openai", model: "adapter-model", capability: "founderWeeklyReview", temperature: 0 } });
        const schema = require("zod").z.object({ ok: require("zod").z.boolean() });
        await expect(generateFounderWeeklyReviewStructured({ prompt: "p", schema })).resolves.toMatchObject({ metadata: { model: "adapter-model" } });
        expect(mockGenerateStructuredWithMetadata).toHaveBeenCalledWith(expect.objectContaining({ capability: "founderWeeklyReview" }));
    });

    it("continues to parse legacy v1 payloads", () => {
        expect(parseFounderWeeklyReviewPayload({
            schemaVersion: "founder-weekly-review/v1",
            sections: Object.fromEntries(["whatChanged", "whatShipped", "whatCustomersSaid", "currentBlockers", "nextPriorities"].map((key) => [key, { heading: key, items: [{ kind: "no_evidence", code: "not_assessed" }] }])),
        }).schemaVersion).toBe("founder-weekly-review/v1");
    });

    it("allows planned evidence to describe future shipment", async () => {
        const payload = validPayload();

        payload.sections.whatChanged = {
            state: "evidence",
            items: [{
                kind: "observed_fact",
                text: "Feature will ship next week.",
                sourceIds: ["doc-1"],
                confidence: 0.8,
            }],
        };

        payload.sections.whatShipped = {
            state: "no_evidence",
            noEvidence: {
                code: "no_relevant_evidence",
                message: "No shipped work yet.",
                cta: "Add shipped evidence",
            },
        };

        await expect(
            generateFounderWeeklyReview({
                evidenceSnapshot: snapshot([
                    source("doc-1", "document_change", "Feature roadmap item.", {
                        evidenceStatus: "planned",
                    }),
                    source("feedback-1", "customer_feedback"),
                    source("context-1", "founder_context"),
                ]),
                generate: fake(payload),
            })
        ).resolves.toBeDefined();
    });


    it("rejects planned evidence described as already shipped", async () => {
        const payload = validPayload();
        payload.sections.whatChanged = {
            state: "evidence",
            items: [{
                kind: "observed_fact",
                text: "Feature shipped yesterday.",
                sourceIds: ["doc-1"],
                confidence: 0.8,
            }],
        };

        await expect(
            generateFounderWeeklyReview({
                evidenceSnapshot: snapshot([
                    source("doc-1", "document_change", "Feature roadmap item.", {
                        evidenceStatus: "planned",
                    }),
                ]),
                generate: fake(payload),
            })
        ).rejects.toThrow("Claim describes planned work as completed.");
    });


    it("allows shipped evidence to describe shipped work", async () => {
        const payload = validPayload();
        payload.sections.whatShipped = {
            state: "evidence",
            items: [{
                kind: "observed_fact",
                text: "Feature shipped yesterday.",
                sourceIds: ["doc-1"],
                confidence: 1,
            }],
        };

        await expect(
            generateFounderWeeklyReview({
                evidenceSnapshot: snapshot([
                    source("doc-1", "document_change", "Feature shipped yesterday.", {
                        evidenceStatus: "shipped",
                    }),
                    source("feedback-1", "customer_feedback"),
                    source("context-1", "founder_context"),
                ]),
                generate: fake(payload),
            })
        ).resolves.toBeDefined();
    });


    it("allows changed evidence to describe updates without implying shipment", async () => {
        const payload = validPayload();
        payload.sections.whatChanged = {
            state: "evidence",
            items: [{
                kind: "observed_fact",
                text: "Documentation was updated.",
                sourceIds: ["doc-1"],
                confidence: 0.8,
            }],
        };

        await expect(
            generateFounderWeeklyReview({
                evidenceSnapshot: snapshot([
                    source("doc-1", "document_change", "Documentation updated.", {
                        evidenceStatus: "changed",
                    }),
                    source("feedback-1", "customer_feedback"),
                    source("context-1", "founder_context"),
                ]),
                generate: fake(payload),
            })
        ).resolves.toBeDefined();
    });
});
