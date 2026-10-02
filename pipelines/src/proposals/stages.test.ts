/**
 * The stages with fake ports: what each one asks the model, how it numbers
 * evidence, and what it refuses to accept from a model's answer.
 */
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import type { RagSearchResult } from "@launchstack/retrieval";
import type { GrantSearchResult } from "@launchstack/tools/grant-search";

import { numberEvidence, validCites } from "./evidence";
import type { ProposalPorts, ProposalStage } from "./ports";
import { renderApplicationMarkdown } from "./render";
import {
    buildOrgProfile,
    draftSection,
    extractRequest,
    findFunders,
    formatProfileBlock,
    reviewApplication,
    rewriteInstruction,
    rewriteSection,
} from "./stages";
import type { ApplicationRecord, OrgProfile, SectionRecord } from "./types";

const NOW = new Date("2026-06-01T00:00:00Z");

function hit(
    documentId: number,
    page: number,
    text: string,
    title = `Doc ${documentId}`
): RagSearchResult {
    return { pageContent: text, metadata: { documentId, page, documentTitle: title } };
}

type Answer = (stage: ProposalStage, user: string) => unknown;

function ports(
    answer: Answer,
    overrides: Partial<ProposalPorts> = {}
): ProposalPorts & { calls: string[] } {
    const calls: string[] = [];
    return {
        calls,
        identity: async () => ({
            name: "Riverbend Literacy",
            description: "After-school reading for Portland kids.",
            industry: "Education",
            numberOfEmployees: "6",
            categories: ["Reports", "Board"],
        }),
        metadataContext: async () => null,
        retrieve: async ({ query }) => {
            calls.push(`retrieve:${query.slice(0, 20)}`);
            return [
                hit(
                    11,
                    2,
                    "Founded in 2014, Riverbend serves 420 children a year across 6 schools."
                ),
                hit(
                    11,
                    2,
                    "Founded in 2014, Riverbend serves 420 children a year across 6 schools."
                ),
                hit(
                    12,
                    1,
                    "In 2025, 78% of participants gained at least one reading level.",
                    "Impact report 2025"
                ),
            ];
        },
        structured: async <T>(
            stage: ProposalStage,
            schema: z.ZodType<T>,
            _system: string,
            user: string
        ) => {
            calls.push(`structured:${stage}`);
            return { result: schema.parse(answer(stage, user)), modelId: `fake/${stage}` };
        },
        searchGrants: async (): Promise<GrantSearchResult> => ({
            opportunities: [
                {
                    source: "grants_gov",
                    externalId: "1",
                    title: "Literacy Innovation Program",
                    funder: "Department of Education",
                    url: "https://www.grants.gov/search-results-detail/1",
                    summary: "Reading programs for K-5.",
                    opensOn: null,
                    closesOn: "2026-08-01",
                    status: "posted",
                    amountMin: null,
                    amountMax: 200_000,
                    eligibility: "Nonprofits",
                    categories: [],
                    opportunityNumber: null,
                },
                {
                    source: "web",
                    externalId: "https://example.org/grants",
                    title: "Community Grants",
                    funder: "Example Foundation",
                    url: "https://example.org/grants",
                    summary: null,
                    opensOn: null,
                    closesOn: null,
                    status: "unknown",
                    amountMin: null,
                    amountMax: null,
                    eligibility: null,
                    categories: [],
                    opportunityNumber: null,
                },
            ],
            sources: [
                { id: "grants_gov", status: "ok", found: 1, detail: null },
                { id: "web", status: "ok", found: 1, detail: null },
            ],
        }),
        fetchPage: null,
        debitCredits: null,
        now: () => NOW,
        ...overrides,
    };
}

describe("evidence", () => {
    it("numbers results in order, dropping duplicates and empties", () => {
        const evidence = numberEvidence([
            hit(1, 1, "alpha"),
            hit(1, 1, "alpha"),
            hit(2, 3, "   "),
            hit(2, 3, "beta"),
        ]);
        expect(evidence.map(e => [e.n, e.documentId, e.quote])).toEqual([
            [1, 1, "alpha"],
            [2, 2, "beta"],
        ]);
        expect(validCites([2, 9, 1, 2, 1.5], evidence)).toEqual([1, 2]);
    });
});

describe("buildOrgProfile", () => {
    it("retrieves every profile query, numbers the evidence, and keeps only cited facts", async () => {
        const p = ports((stage, user) => {
            expect(stage).toBe("profile");
            expect(user).toContain("Riverbend Literacy");
            expect(user).toContain("[1] Doc 11 (p. 2)");
            expect(user).toContain("[2] Impact report 2025");
            return {
                summary: "Riverbend runs after-school reading programmes.",
                applicantType: "nonprofit",
                focusAreas: ["youth literacy", ""],
                geography: ["Portland, Oregon"],
                facts: [
                    { key: "Founded", label: "Founded", value: "2014", cites: [1] },
                    {
                        key: "outcomes",
                        label: "Outcomes",
                        value: "78% gained a level (2025)",
                        cites: [2, 7],
                    },
                    { key: "budget", label: "Budget", value: "$2m", cites: [] },
                ],
            };
        });
        const profile = await buildOrgProfile(p, { companyId: 1 });
        expect(p.calls.filter(c => c.startsWith("retrieve:"))).toHaveLength(9);
        expect(profile.evidence).toHaveLength(2);
        expect(profile.facts.map(f => [f.key, f.cites])).toEqual([
            ["founded", [1]],
            ["outcomes", [2]],
        ]);
        expect(profile.focusAreas).toEqual(["youth literacy"]);
        expect(profile.builtFrom).toEqual({ documents: 2, snippets: 2 });
        expect(profile.modelId).toBe("fake/profile");
        expect(formatProfileBlock(profile)).toContain("- Founded: 2014");
    });
});

const PROFILE: OrgProfile = {
    summary: "Riverbend runs after-school reading programmes.",
    applicantType: "nonprofit",
    focusAreas: ["youth literacy"],
    geography: ["Portland, Oregon"],
    facts: [{ key: "founded", label: "Founded", value: "2014", cites: [1], source: "documents" }],
    evidence: [],
    builtFrom: { documents: 1, snippets: 1 },
    builtAt: NOW.toISOString(),
    promptVersion: "test",
};

describe("findFunders", () => {
    it("plans from the profile, searches, scores, and sorts by fit", async () => {
        const p = ports(stage => {
            if (stage === "plan")
                return {
                    keywords: ["youth literacy", "after-school"],
                    applicantType: "nonprofit",
                    geography: "Oregon",
                    rationale: "Because.",
                };
            return {
                scores: [
                    {
                        externalId: "https://example.org/grants",
                        score: 40,
                        why: ["local"],
                        concerns: [],
                    },
                    {
                        externalId: "1",
                        score: 85,
                        why: ["names reading programs"],
                        concerns: ["federal reporting"],
                    },
                ],
            };
        });
        const result = await findFunders(p, { profile: PROFILE });
        expect(result.plan.keywords).toEqual(["youth literacy", "after-school"]);
        expect(result.scored.map(s => [s.opportunity.externalId, s.fit?.score])).toEqual([
            ["1", 85],
            ["https://example.org/grants", 40],
        ]);
        expect(p.calls).toEqual(["structured:plan", "structured:score"]);
    });

    it("skips planning when keywords are given, and refuses with neither", async () => {
        const p = ports(() => ({ scores: [] }));
        const result = await findFunders(p, {
            profile: PROFILE,
            overrides: { keywords: ["climate"], geography: "Alaska" },
        });
        expect(result.plan).toMatchObject({ keywords: ["climate"], geography: "Alaska" });
        expect(p.calls).toEqual(["structured:score"]);
        await expect(
            findFunders(
                ports(() => ({})),
                { profile: null }
            )
        ).rejects.toThrow(/profile first/);
    });
});

describe("extractRequest", () => {
    it("reads a request and builds the checklist; refuses a stub", async () => {
        const p = ports(() => ({
            title: "Literacy Innovation Program",
            funder: "ED",
            summary: "Reading programmes.",
            deadline: "2026-08-01",
            amountMin: null,
            amountMax: 200000,
            eligibility: ["Nonprofit"],
            sections: [
                {
                    key: "need",
                    question: "Statement of need",
                    guidance: null,
                    wordLimit: 500,
                    required: true,
                },
                {
                    key: "need",
                    question: "Statement of need",
                    guidance: null,
                    wordLimit: 500,
                    required: true,
                },
            ],
            attachments: ["Budget"],
            format: [],
        }));
        const { extracted, requirements } = await extractRequest(p, { text: "x".repeat(100) });
        expect(extracted.sections.map(s => s.key)).toEqual(["need", "need-2"]);
        expect(requirements.map(r => r.kind)).toEqual([
            "eligibility",
            "deadline",
            "budget",
            "section",
            "section",
            "attachment",
        ]);
        await expect(extractRequest(p, { text: "short" })).rejects.toThrow(/too short/);
    });
});

function application(partial: Partial<ApplicationRecord> = {}): ApplicationRecord {
    return {
        id: "a1",
        companyId: 1n,
        opportunityId: null,
        title: "Literacy Innovation",
        funder: "ED",
        status: "in_progress",
        deadline: "2026-08-01",
        ownerUserId: "u",
        requestText: null,
        requestUrl: null,
        requestDocumentId: null,
        extracted: null,
        requirements: [],
        review: null,
        readiness: 0,
        notes: null,
        exportedDocumentId: null,
        submittedAt: null,
        createdByUserId: "u",
        createdAt: NOW,
        updatedAt: null,
        ...partial,
    };
}

function section(partial: Partial<SectionRecord> & { key: string }): SectionRecord {
    return {
        id: `s-${partial.key}`,
        companyId: 1n,
        applicationId: "a1",
        position: 0,
        question: `Q ${partial.key}`,
        guidance: null,
        wordLimit: null,
        required: true,
        status: "empty",
        draft: null,
        draftMeta: null,
        createdAt: NOW,
        updatedAt: null,
        ...partial,
    };
}

describe("draftSection", () => {
    it("hands the model the question, the profile, numbered evidence and saved answers, then keeps only real citations", async () => {
        const p = ports((stage, user) => {
            expect(stage).toBe("draft");
            expect(user).toContain("QUESTION: Describe your outcomes");
            expect(user).toContain("WORD LIMIT: 300");
            expect(user).toContain("- Founded: 2014");
            expect(user).toContain("[2] Impact report 2025");
            expect(user).toContain("Saved answer 1");
            return {
                draft: "In 2025, 78% of our readers gained a level.",
                cites: [2, 5],
                gaps: ["2026 figures", " "],
            };
        });
        const result = await draftSection(p, {
            companyId: 1,
            application: application(),
            section: section({
                key: "outcomes",
                question: "Describe your outcomes",
                wordLimit: 300,
            }),
            profile: PROFILE,
            library: [
                {
                    id: "lib1",
                    companyId: 1n,
                    question: "Describe the outcomes you achieved",
                    answer: "Last year 70% gained a level.",
                    tags: [],
                    evidence: [],
                    sourceApplicationId: null,
                    sourceSectionKey: null,
                    uses: 0,
                    createdByUserId: "u",
                    createdAt: NOW,
                    updatedAt: null,
                },
            ],
        });
        expect(result.meta.cites).toEqual([2]);
        expect(result.meta.gaps).toEqual(["2026 figures"]);
        expect(result.meta.libraryItemIds).toEqual(["lib1"]);
        expect(result.meta.evidence).toHaveLength(2);
    });
});

describe("rewriteSection", () => {
    it("rewrites under the preset's instruction, citing only the evidence the draft had", async () => {
        const evidence = [
            {
                n: 1,
                documentId: 11,
                title: "Doc 11",
                page: 2,
                quote: "Founded in 2014.",
                url: null,
            },
        ];
        const p = ports((stage, user) => {
            expect(stage).toBe("rewrite");
            expect(user).toContain("INSTRUCTION: Tighten it to at most 120 words");
            expect(user).toContain("CURRENT DRAFT (8 words)");
            expect(user).toContain("[1] Doc 11");
            return {
                draft: "We were founded in 2014 and serve 420 children.",
                cites: [1, 4],
                gaps: ["the 2026 target"],
            };
        });
        const result = await rewriteSection(p, {
            application: application(),
            section: section({
                key: "history",
                question: "History",
                wordLimit: 120,
                draft: "Riverbend was founded in 2014, serving many children.",
                draftMeta: {
                    cites: [1],
                    gaps: ["staff count"],
                    evidence,
                    libraryItemIds: ["lib1"],
                },
            }),
            profile: PROFILE,
            preset: "tighten",
        });
        expect(result.meta.cites).toEqual([1]);
        expect(result.meta.gaps).toEqual(["staff count", "the 2026 target"]);
        expect(result.meta.libraryItemIds).toEqual(["lib1"]);
        expect(p.calls).toEqual(["structured:rewrite"]);
        await expect(
            rewriteSection(p, {
                application: application(),
                section: section({ key: "x" }),
                profile: null,
                preset: "plainer",
            })
        ).rejects.toThrow(/no draft/);
    });

    it("spells out each preset, using the person's words for custom", () => {
        expect(rewriteInstruction("tighten", undefined, 300)).toContain("at most 300 words");
        expect(rewriteInstruction("tighten", undefined, null)).toContain("a third");
        expect(rewriteInstruction("custom", "  Lead with the summer programme. ", null)).toBe(
            "Lead with the summer programme."
        );
        expect(rewriteInstruction("custom", "", null)).toMatch(/Improve it/);
    });
});

describe("reviewApplication", () => {
    it("combines deterministic checks with the model's findings and computes readiness", async () => {
        const p = ports((stage, user) => {
            expect(stage).toBe("review");
            expect(user).toContain("## plan");
            return {
                summary: "Solid need, thin plan.",
                findings: [
                    {
                        severity: "warning",
                        kind: "weak",
                        sectionKey: "plan",
                        message: "No timeline.",
                        suggestion: "Add one.",
                    },
                    {
                        severity: "note",
                        kind: "weak",
                        sectionKey: "nope",
                        message: "Unknown key.",
                        suggestion: null,
                    },
                ],
            };
        });
        const review = await reviewApplication(p, {
            application: application({
                requirements: [
                    {
                        id: "e1",
                        kind: "eligibility",
                        text: "Nonprofit",
                        done: true,
                        sectionKey: null,
                    },
                    {
                        id: "section:need",
                        kind: "section",
                        text: "Answer: need",
                        done: false,
                        sectionKey: "need",
                    },
                    {
                        id: "section:plan",
                        kind: "section",
                        text: "Answer: plan",
                        done: false,
                        sectionKey: "plan",
                    },
                ],
            }),
            sections: [
                section({
                    key: "need",
                    status: "approved",
                    draft: "We serve 420 children.",
                    draftMeta: { cites: [1], gaps: [], evidence: [], libraryItemIds: [] },
                }),
                section({
                    key: "plan",
                    status: "drafted",
                    draft: "We will do more.",
                    draftMeta: { cites: [1], gaps: [], evidence: [], libraryItemIds: [] },
                }),
            ],
            profile: PROFILE,
        });
        expect(review.summary).toBe("Solid need, thin plan.");
        expect(review.findings.map(f => [f.kind, f.sectionKey])).toEqual([
            ["weak", "plan"],
            ["weak", null],
        ]);
        // sections (1 + 0.6)/2 = 0.8 → 56; checklist 1/1 → 30
        expect(review.readiness).toBe(86);
    });

    it("does not call the model when nothing is written", async () => {
        const p = ports(() => {
            throw new Error("should not be called");
        });
        const review = await reviewApplication(p, {
            application: application(),
            sections: [section({ key: "need" })],
            profile: null,
        });
        expect(review.summary).toBe("Nothing has been written yet.");
        expect(review.findings.map(f => f.id)).toEqual(["missing:need"]);
        expect(p.calls).toEqual([]);
    });
});

describe("renderApplicationMarkdown", () => {
    it("writes sections, renumbers evidence across them, and lists the checklist", () => {
        const evidence = {
            n: 3,
            documentId: 12,
            title: "Impact report 2025",
            page: 1,
            quote: "78% gained a level.",
            url: null,
        };
        const markdown = renderApplicationMarkdown({
            application: application({
                requirements: [
                    {
                        id: "e1",
                        kind: "eligibility",
                        text: "Nonprofit",
                        done: true,
                        sectionKey: null,
                    },
                    {
                        id: "s",
                        kind: "section",
                        text: "Answer: need",
                        done: false,
                        sectionKey: "need",
                    },
                ],
            }),
            sections: [
                section({
                    key: "need",
                    question: "Need",
                    status: "drafted",
                    draft: "Kids need books.",
                    wordLimit: 100,
                    draftMeta: {
                        cites: [3],
                        gaps: ["numbers"],
                        evidence: [evidence],
                        libraryItemIds: [],
                    },
                }),
                section({ key: "plan", question: "Plan" }),
            ],
            exportedAt: NOW,
        });
        expect(markdown).toContain("# Literacy Innovation");
        expect(markdown).toContain("## Need\n*Limit 100 words · draft 3 words*");
        expect(markdown).toContain("Sources: [E1]");
        expect(markdown).toContain("Still needed: numbers");
        expect(markdown).toContain("_Not written yet._");
        expect(markdown).toContain("- [x] Nonprofit");
        expect(markdown).toContain("- [E1] Impact report 2025, p. 1");
        expect(markdown).not.toContain("Answer: need");
    });
});
