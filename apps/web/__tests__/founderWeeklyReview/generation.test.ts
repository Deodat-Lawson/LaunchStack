jest.mock("~/lib/models", () => ({
    resolveConfiguredChatModel: jest.fn(),
}));
jest.mock("@launchstack/core/llm", () => ({
    invokeStructured: jest.fn(),
}));

import {
    FOUNDER_WEEKLY_REVIEW_V2_SCHEMA_VERSION,
    FounderWeeklyReviewV2PayloadSchema,
    buildFounderWeeklyReviewPrompt,
    buildGenerationEvidenceEnvelope,
    generateFounderWeeklyReview,
    parseFounderWeeklyReviewPayload,
    type FounderWeeklyReviewEvidenceSnapshot,
    type FounderWeeklyReviewV2Payload,
} from "@launchstack/features/founder-weekly-review";
import { FounderWeeklyReviewGenerationValidationError } from "@launchstack/features/founder-weekly-review";
import { invokeStructured } from "@launchstack/core/llm";
import { z } from "zod";
import { generateFounderWeeklyReviewStructured } from "~/server/founder-weekly-review/generation-adapter";
import { resolveConfiguredChatModel } from "~/lib/models";

const mockResolveConfiguredChatModel = resolveConfiguredChatModel as jest.Mock;
const mockInvokeStructured = invokeStructured as jest.Mock;

function snapshot(
    items: FounderWeeklyReviewEvidenceSnapshot["items"]
): FounderWeeklyReviewEvidenceSnapshot {
    return {
        schemaVersion: "founder-weekly-review-evidence/v1",
        capturedAt: "2026-07-18T10:00:00.000Z",
        reportingPeriod: { start: "2026-07-07", end: "2026-07-13" },
        workspaceTimezone: "UTC",
        items,
        sourceWarnings: [],
    };
}

const source = (
    sourceId: string,
    sourceType: FounderWeeklyReviewEvidenceSnapshot["items"][number]["sourceType"],
    excerpt = "Evidence excerpt"
) => ({
    sourceId,
    sourceType,
    title: `${sourceType} title`,
    excerpt,
    metadata: {},
});

function noEvidence(message = "No evidence", cta = "Add evidence") {
    return {
        state: "no_evidence" as const,
        noEvidence: { code: "no_relevant_evidence", message, cta },
    };
}

function validPayload(): FounderWeeklyReviewV2Payload {
    return {
        schemaVersion: FOUNDER_WEEKLY_REVIEW_V2_SCHEMA_VERSION,
        sections: {
            whatChanged: {
                state: "evidence",
                items: [
                    {
                        kind: "observed_fact",
                        text: "The plan changed.",
                        sourceIds: ["doc-1"],
                        confidence: 0,
                    },
                ],
            },
            whatShipped: {
                state: "evidence",
                items: [
                    {
                        kind: "observed_fact",
                        text: "A release shipped.",
                        sourceIds: ["doc-1"],
                        confidence: 1,
                    },
                ],
            },
            whatCustomersSaid: {
                state: "evidence",
                items: [
                    {
                        kind: "observed_fact",
                        text: "A customer requested audit logs.",
                        sourceIds: ["feedback-1"],
                        confidence: 0.5,
                    },
                ],
            },
            currentBlockers: {
                state: "evidence",
                items: [
                    {
                        kind: "observed_fact",
                        text: "SSO remains blocked.",
                        sourceIds: ["context-1"],
                        confidence: 0.8,
                    },
                ],
            },
            nextPriorities: {
                state: "evidence",
                items: [
                    {
                        kind: "recommendation",
                        label: "Recommendation",
                        text: "Prioritize SSO.",
                        sourceIds: ["context-1"],
                        confidence: 0.8,
                    },
                ],
            },
        },
    };
}

function fake(
    object: unknown,
    metadata = {
        provider: "openai",
        model: "test-model",
        capability: "founderWeeklyReview",
        temperature: 0,
    }
) {
    return jest.fn().mockResolvedValue({ object, metadata });
}

const completeSnapshot = () =>
    snapshot([
        source("doc-1", "document_change", "A release shipped."),
        source("feedback-1", "customer_feedback", "Please add audit logs."),
        source("context-1", "founder_context", "SSO remains blocked."),
    ]);

describe("Founder Weekly Review generation", () => {
    it("generates complete evidence with numeric lower and upper confidence bounds", async () => {
        const generate = fake(validPayload());
        const result = await generateFounderWeeklyReview({
            evidenceSnapshot: completeSnapshot(),
            generate,
        });
        expect(result.reviewPayload).toEqual(validPayload());
        expect(result.modelMetadata).toMatchObject({
            provider: "openai",
            temperature: 0,
            capability: "founderWeeklyReview",
        });
        expect(result.modelMetadata.promptHash).toMatch(/^[a-f0-9]{64}$/);
        expect(generate).toHaveBeenCalledTimes(1);
        expect(generate.mock.calls[0][0]).toMatchObject({ generationPhase: "initial" });
    });

    it("performs exactly one semantic repair against the same immutable snapshot", async () => {
        const invalid = validPayload();
        invalid.sections.whatCustomersSaid = {
            state: "evidence",
            items: [
                {
                    kind: "observed_fact",
                    text: "Founder direction was presented as customer feedback.",
                    sourceIds: ["context-1"],
                    confidence: 0.5,
                },
            ],
        };
        const repaired = validPayload();
        const generate = jest
            .fn()
            .mockResolvedValueOnce({
                object: invalid,
                metadata: {
                    provider: "kimi",
                    model: "kimi-k2.6",
                    capability: "founderWeeklyReview",
                },
            })
            .mockResolvedValueOnce({
                object: repaired,
                metadata: {
                    provider: "kimi",
                    model: "kimi-k2.6",
                    capability: "founderWeeklyReview",
                },
            });
        const evidenceSnapshot = completeSnapshot();

        await expect(
            generateFounderWeeklyReview({ evidenceSnapshot, generate })
        ).resolves.toMatchObject({ reviewPayload: repaired });

        expect(generate).toHaveBeenCalledTimes(2);
        expect(generate.mock.calls[0][0]).toMatchObject({ generationPhase: "initial" });
        expect(generate.mock.calls[1][0]).toMatchObject({ generationPhase: "semantic-repair" });
        expect(generate.mock.calls[1][0].prompt).toContain(
            "founder_context is founder-provided direction, not customer testimony."
        );
        expect(generate.mock.calls[1][0].prompt).toContain("context-1");
        expect(evidenceSnapshot).toEqual(completeSnapshot());
    });

    it("fails normally after one invalid semantic repair and never makes a third call", async () => {
        const invalid = validPayload();
        invalid.sections.whatCustomersSaid = {
            state: "evidence",
            items: [
                {
                    kind: "observed_fact",
                    text: "Invalid customer claim.",
                    sourceIds: ["context-1"],
                    confidence: 0.5,
                },
            ],
        };
        const generate = jest
            .fn()
            .mockResolvedValueOnce({
                object: invalid,
                metadata: {
                    provider: "kimi",
                    model: "kimi-k2.6",
                    capability: "founderWeeklyReview",
                },
            })
            .mockResolvedValueOnce({
                object: invalid,
                metadata: {
                    provider: "kimi",
                    model: "kimi-k2.6",
                    capability: "founderWeeklyReview",
                },
            });

        await expect(
            generateFounderWeeklyReview({ evidenceSnapshot: completeSnapshot(), generate })
        ).rejects.toMatchObject({
            name: "FounderWeeklyReviewGenerationValidationError",
        });
        expect(generate).toHaveBeenCalledTimes(2);
    });

    it("does not semantic-repair provider failures", async () => {
        const generate = jest.fn().mockRejectedValue(new Error("provider unavailable"));
        await expect(
            generateFounderWeeklyReview({ evidenceSnapshot: completeSnapshot(), generate })
        ).rejects.toThrow("provider unavailable");
        expect(generate).toHaveBeenCalledTimes(1);
    });

    it("allows partial reviews with typed no-evidence sections", async () => {
        const payload = validPayload();
        payload.sections.whatShipped = noEvidence();
        payload.sections.whatCustomersSaid = noEvidence();
        const result = await generateFounderWeeklyReview({
            evidenceSnapshot: completeSnapshot(),
            generate: fake(payload),
        });
        expect(result.reviewPayload.sections.whatShipped.state).toBe("no_evidence");
    });

    it("preserves contradictory evidence rather than resolving it", async () => {
        const payload = validPayload();
        payload.sections.currentBlockers = {
            state: "evidence",
            items: [
                {
                    kind: "contradictory_evidence",
                    text: "The blocker status conflicts.",
                    sourceIds: ["doc-1", "context-1"],
                    confidence: 0.6,
                },
            ],
        };
        const result = await generateFounderWeeklyReview({
            evidenceSnapshot: completeSnapshot(),
            generate: fake(payload),
        });
        expect(result.reviewPayload.sections.currentBlockers).toMatchObject({
            state: "evidence",
            items: [{ kind: "contradictory_evidence" }],
        });
    });

    it("returns deterministic empty states and performs zero LLM calls for an empty snapshot", async () => {
        const generate = fake(validPayload());
        const result = await generateFounderWeeklyReview({
            evidenceSnapshot: snapshot([]),
            generate,
        });
        expect(generate).not.toHaveBeenCalled();
        expect(result.reviewPayload.sections.nextPriorities).toMatchObject({
            state: "no_evidence",
        });
        expect(result.modelMetadata).toMatchObject({
            provider: "skipped",
            model: "none",
            attributes: { generationSkipped: true },
        });
        for (const section of Object.values(result.reviewPayload.sections)) {
            expect(section.state).toBe("no_evidence");
            if (section.state === "no_evidence") {
                expect(section.noEvidence.cta.trim()).not.toBe("");
            }
        }
    });

    it.each([
        [
            "unknown generated source ID",
            (p: FounderWeeklyReviewV2Payload) => {
                p.sections.whatChanged = {
                    state: "evidence",
                    items: [
                        {
                            kind: "observed_fact",
                            text: "x",
                            sourceIds: ["missing"],
                            confidence: 0.5,
                        },
                    ],
                };
            },
        ],
        [
            "duplicate generated citations",
            (p: FounderWeeklyReviewV2Payload) => {
                p.sections.whatChanged = {
                    state: "evidence",
                    items: [
                        {
                            kind: "observed_fact",
                            text: "x",
                            sourceIds: ["doc-1", "doc-1"],
                            confidence: 0.5,
                        },
                    ],
                };
            },
        ],
        [
            "customer section citing document_change",
            (p: FounderWeeklyReviewV2Payload) => {
                p.sections.whatCustomersSaid = {
                    state: "evidence",
                    items: [
                        { kind: "observed_fact", text: "x", sourceIds: ["doc-1"], confidence: 0.5 },
                    ],
                };
            },
        ],
        [
            "customer section citing founder_context",
            (p: FounderWeeklyReviewV2Payload) => {
                p.sections.whatCustomersSaid = {
                    state: "evidence",
                    items: [
                        {
                            kind: "observed_fact",
                            text: "x",
                            sourceIds: ["context-1"],
                            confidence: 0.5,
                        },
                    ],
                };
            },
        ],
        [
            "contradiction with fewer than two citations",
            (p: FounderWeeklyReviewV2Payload) => {
                p.sections.currentBlockers = {
                    state: "evidence",
                    items: [
                        {
                            kind: "contradictory_evidence",
                            text: "x",
                            sourceIds: ["doc-1"],
                            confidence: 0.5,
                        },
                    ],
                };
            },
        ],
        [
            "recommendation outside nextPriorities",
            (p: FounderWeeklyReviewV2Payload) => {
                p.sections.whatChanged = {
                    state: "evidence",
                    items: [
                        {
                            kind: "recommendation",
                            label: "Recommendation",
                            text: "x",
                            sourceIds: ["doc-1"],
                            confidence: 0.5,
                        },
                    ],
                } as never;
            },
        ],
    ])("rejects %s", async (_name, mutate) => {
        const payload = validPayload();
        mutate(payload);
        await expect(
            generateFounderWeeklyReview({
                evidenceSnapshot: completeSnapshot(),
                generate: fake(payload),
            })
        ).rejects.toBeInstanceOf(Error);
    });

    it.each(["whatChanged", "whatShipped"] as const)(
        "rejects workspace_document-only %s claims",
        async sectionName => {
            const payload = validPayload();
            payload.sections[sectionName] = {
                state: "evidence",
                items: [
                    {
                        kind: "observed_fact",
                        text: "Current document implies a weekly event.",
                        sourceIds: ["workspace-1"],
                        confidence: 0.5,
                    },
                ],
            };
            await expect(
                generateFounderWeeklyReview({
                    evidenceSnapshot: snapshot([source("workspace-1", "workspace_document")]),
                    generate: fake(payload),
                })
            ).rejects.toBeInstanceOf(FounderWeeklyReviewGenerationValidationError);
        }
    );

    it.each(["whatChanged", "whatShipped"] as const)(
        "allows document_change plus workspace_document in %s",
        async sectionName => {
            const payload = validPayload();
            payload.sections[sectionName] = {
                state: "evidence",
                items: [
                    {
                        kind: "observed_fact",
                        text: "A dated change has current context.",
                        sourceIds: ["doc-1", "workspace-1"],
                        confidence: 0.5,
                    },
                ],
            };
            await expect(
                generateFounderWeeklyReview({
                    evidenceSnapshot: snapshot([
                        ...completeSnapshot().items,
                        source("workspace-1", "workspace_document"),
                    ]),
                    generate: fake(payload),
                })
            ).resolves.toBeDefined();
        }
    );

    it("allows workspace_document for blockers and priorities while customer-only enforcement remains", async () => {
        const payload = validPayload();
        payload.sections.currentBlockers = {
            state: "evidence",
            items: [
                {
                    kind: "observed_fact",
                    text: "Current context",
                    sourceIds: ["workspace-1"],
                    confidence: 0.5,
                },
            ],
        };
        payload.sections.nextPriorities = {
            state: "evidence",
            items: [
                {
                    kind: "recommendation",
                    label: "Recommendation",
                    text: "Act on current context",
                    sourceIds: ["workspace-1"],
                    confidence: 0.5,
                },
            ],
        };
        await expect(
            generateFounderWeeklyReview({
                evidenceSnapshot: snapshot([
                    ...completeSnapshot().items,
                    source("workspace-1", "workspace_document"),
                ]),
                generate: fake(payload),
            })
        ).resolves.toBeDefined();
    });

    it("rejects duplicate input source IDs before calling the model", async () => {
        const generate = fake(validPayload());
        await expect(
            generateFounderWeeklyReview({
                evidenceSnapshot: snapshot([
                    source("same", "manual_note"),
                    source("same", "document_change"),
                ]),
                generate,
            })
        ).rejects.toBeInstanceOf(FounderWeeklyReviewGenerationValidationError);
        expect(generate).not.toHaveBeenCalled();
    });

    it("enforces numeric confidence bounds", () => {
        const payload = validPayload();
        payload.sections.whatChanged = {
            state: "evidence",
            items: [{ kind: "observed_fact", text: "x", sourceIds: ["doc-1"], confidence: -0.01 }],
        };
        expect(FounderWeeklyReviewV2PayloadSchema.safeParse(payload).success).toBe(false);
        (
            payload.sections.whatChanged as {
                state: "evidence";
                items: Array<{ confidence: number }>;
            }
        ).items[0]!.confidence = 1.01;
        expect(FounderWeeklyReviewV2PayloadSchema.safeParse(payload).success).toBe(false);
    });

    it("enforces the concise contract of at most three items per section", () => {
        const payload = validPayload();
        const item =
            payload.sections.whatChanged.state === "evidence"
                ? payload.sections.whatChanged.items[0]!
                : undefined;
        expect(item).toBeDefined();
        payload.sections.whatChanged = {
            state: "evidence",
            items: [item!, item!, item!, item!],
        };
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
        evidenceSnapshot.sourceWarnings = [
            { code: "warning-1", message: "Missing source", sourceType: "github_activity" },
        ];
        const payload = validPayload();
        payload.sections.whatChanged = {
            state: "evidence",
            items: [
                { kind: "observed_fact", text: "x", sourceIds: ["warning-1"], confidence: 0.5 },
            ],
        };
        await expect(
            generateFounderWeeklyReview({ evidenceSnapshot, generate: fake(payload) })
        ).rejects.toBeInstanceOf(Error);
    });

    it("puts anti-invention requirements in the prompt and hashes a fixed fixture stably", async () => {
        const generateA = fake(validPayload());
        const generateB = fake(validPayload());
        const first = await generateFounderWeeklyReview({
            evidenceSnapshot: completeSnapshot(),
            generate: generateA,
        });
        const second = await generateFounderWeeklyReview({
            evidenceSnapshot: completeSnapshot(),
            generate: generateB,
        });
        expect(generateA.mock.calls[0][0].system).toContain("Never invent");
        expect(generateA.mock.calls[0][0].system).toContain(
            "whatCustomersSaid may cite only customer_feedback"
        );
        for (const prohibitedFact of [
            "customers",
            "people",
            "dates",
            "metrics",
            "shipped work",
            "blockers",
            "outcomes",
            "source IDs",
        ]) {
            expect(generateA.mock.calls[0][0].system).toContain(prohibitedFact);
        }
        expect(first.modelMetadata.promptHash).toBe(second.modelMetadata.promptHash);
    });

    it("canonicalizes metadata key order before building the prompt and hash", async () => {
        const firstSnapshot = completeSnapshot();
        firstSnapshot.items[0]!.metadata = {
            changeType: "modified",
            alignmentMethod: "structure_path",
        };
        const secondSnapshot = completeSnapshot();
        secondSnapshot.items[0]!.metadata = {
            alignmentMethod: "structure_path",
            changeType: "modified",
        };
        expect(buildFounderWeeklyReviewPrompt(firstSnapshot)).toBe(
            buildFounderWeeklyReviewPrompt(secondSnapshot)
        );

        const first = await generateFounderWeeklyReview({
            evidenceSnapshot: firstSnapshot,
            generate: fake(validPayload()),
        });
        const second = await generateFounderWeeklyReview({
            evidenceSnapshot: secondSnapshot,
            generate: fake(validPayload()),
        });
        expect(first.modelMetadata.promptHash).toBe(second.modelMetadata.promptHash);
    });

    it("uses the concise founder-review generation contract", async () => {
        const generate = fake(validPayload());
        await generateFounderWeeklyReview({ evidenceSnapshot: completeSnapshot(), generate });
        const system = generate.mock.calls[0][0].system as string;
        expect(system).toContain("decision-oriented founder review, not an evidence transcript");
        expect(system).toContain("at most 3 items in each section");
        expect(system).toContain("one concise sentence whenever possible");
        expect(system).toContain("Synthesize related evidence into one focused claim");
        expect(system).toContain("do not create one output item per evidence source");
        expect(system).toContain("optional rationale should be brief");
        expect(system).not.toContain("2–4 sentences per substantive item");
        expect(system).not.toContain("600–1,000 words overall");
    });

    it("changes the prompt hash when selected evidence changes", async () => {
        const firstSnapshot = completeSnapshot();
        const secondSnapshot = completeSnapshot();
        secondSnapshot.items[0]!.excerpt = "A different release shipped.";
        const first = await generateFounderWeeklyReview({
            evidenceSnapshot: firstSnapshot,
            generate: fake(validPayload()),
        });
        const second = await generateFounderWeeklyReview({
            evidenceSnapshot: secondSnapshot,
            generate: fake(validPayload()),
        });
        expect(first.modelMetadata.promptHash).not.toBe(second.modelMetadata.promptHash);
    });

    it("normally truncates large evidence before generation and persists aggregate diagnostics", async () => {
        const items = Array.from({ length: 250 }, (_, index) => ({
            ...source(
                `document_change:doc:${(index % 3) + 1}:v1:v2:chunk:${index}:${index}`,
                "document_change",
                "x".repeat(200)
            ),
            sourceTimestamp: `2026-07-${String((index % 7) + 7).padStart(2, "0")}T10:00:00.000Z`,
            metadata: {
                documentId: String((index % 3) + 1),
                previousVersionId: 1,
                currentVersionId: 2,
                changeType: "modified",
            },
        }));
        const payload: FounderWeeklyReviewV2Payload = {
            schemaVersion: FOUNDER_WEEKLY_REVIEW_V2_SCHEMA_VERSION,
            sections: {
                whatChanged: noEvidence(),
                whatShipped: noEvidence(),
                whatCustomersSaid: noEvidence(),
                currentBlockers: noEvidence(),
                nextPriorities: noEvidence(),
            },
        };
        const generate = fake(payload);
        const result = await generateFounderWeeklyReview({
            evidenceSnapshot: snapshot(items),
            generate,
        });

        expect(generate).toHaveBeenCalledTimes(1);
        const prompt = JSON.parse(generate.mock.calls[0][0].prompt);
        expect(prompt.evidence).toHaveLength(24);
        expect(result.modelMetadata.attributes).toEqual(
            expect.objectContaining({
                evidenceEnvelopeOriginalItems: 250,
                evidenceEnvelopeSelectedItems: 24,
                evidenceEnvelopeExcludedItems: 226,
                evidenceEnvelopeTruncated: true,
            })
        );
    });

    it("continues to validate citations against the complete immutable snapshot", async () => {
        const items = Array.from({ length: 30 }, (_, index) => ({
            ...source(
                `document_change:doc:1:v1:v2:chunk:${index}:${index}`,
                "document_change",
                "x".repeat(200)
            ),
            metadata: {
                documentId: "1",
                previousVersionId: 1,
                currentVersionId: 2,
                changeType: "modified",
            },
        }));
        const evidenceSnapshot = snapshot(items);
        const selectedIds = new Set(
            buildGenerationEvidenceEnvelope(evidenceSnapshot).items.map(item => item.sourceId)
        );
        const excludedId = evidenceSnapshot.items.find(
            item => !selectedIds.has(item.sourceId)
        )!.sourceId;
        const payload: FounderWeeklyReviewV2Payload = {
            schemaVersion: FOUNDER_WEEKLY_REVIEW_V2_SCHEMA_VERSION,
            sections: {
                whatChanged: {
                    state: "evidence",
                    items: [
                        {
                            kind: "observed_fact",
                            text: "A source-backed change.",
                            sourceIds: [excludedId],
                            confidence: 0.5,
                        },
                    ],
                },
                whatShipped: noEvidence(),
                whatCustomersSaid: noEvidence(),
                currentBlockers: noEvidence(),
                nextPriorities: noEvidence(),
            },
        };

        await expect(
            generateFounderWeeklyReview({ evidenceSnapshot, generate: fake(payload) })
        ).resolves.toMatchObject({ reviewPayload: payload });
        expect(evidenceSnapshot.items).toHaveLength(30);
    });

    it("resolves the reasoning route and reports the configured model as metadata", async () => {
        mockResolveConfiguredChatModel.mockReturnValue({
            route: "reasoning",
            name: "deep",
            modelId: "adapter-model",
        });
        mockInvokeStructured.mockResolvedValue({ ok: true });

        const schema = z.object({ ok: z.boolean() });
        await expect(
            generateFounderWeeklyReviewStructured({ prompt: "p", schema })
        ).resolves.toMatchObject({
            object: { ok: true },
            metadata: {
                provider: "deep",
                model: "adapter-model",
                capability: "founderWeeklyReview",
            },
        });

        // The review is a synthesis task; it must not silently fall back to the
        // default route when the operator has pointed reasoning elsewhere.
        expect(mockResolveConfiguredChatModel).toHaveBeenCalledWith({
            route: "reasoning",
            maxOutputTokens: 2_400,
        });
    });

    it("continues to parse legacy v1 payloads", () => {
        expect(
            parseFounderWeeklyReviewPayload({
                schemaVersion: "founder-weekly-review/v1",
                sections: Object.fromEntries(
                    [
                        "whatChanged",
                        "whatShipped",
                        "whatCustomersSaid",
                        "currentBlockers",
                        "nextPriorities",
                    ].map(key => [
                        key,
                        { heading: key, items: [{ kind: "no_evidence", code: "not_assessed" }] },
                    ])
                ),
            }).schemaVersion
        ).toBe("founder-weekly-review/v1");
    });
});
