/**
 * The rules a starter question must obey, pinned without a model or a
 * database: a generated set is shaped and padded, unknown documents are never
 * pinned, and the deterministic fallback still reads as this workspace's.
 */

import {
    buildStarterPrompt,
    completeStarters,
    displayTitle,
    fallbackStarters,
    hasEvidence,
    relativeAge,
    sanitizeStarters,
    type WorkspaceBrief,
} from "~/server/ask-starters/starters";

const BRIEF: WorkspaceBrief = {
    company: {
        name: "Acme Robotics",
        description: "Warehouse automation for mid-size distributors.",
        industry: "Industrial automation",
        size: "11-50",
    },
    profileText:
        "=== Company ===\nName: Acme Robotics\n=== Services & Products ===\n- PickBot: robotic picking",
    sourceCount: 42,
    folders: [
        { name: "Contracts", count: 12 },
        { name: "HR", count: 8 },
    ],
    recentDocuments: [
        { id: 17, title: "Globex MSA 2026.pdf", folder: "Contracts", ageLabel: "2 days ago" },
        { id: 16, title: "PickBot v3 spec.docx", folder: "Engineering", ageLabel: "last week" },
    ],
    connections: ["google-drive"],
    fingerprint: "42:17:0:google-drive",
};

describe("sanitizeStarters", () => {
    it("drops document ids the workspace does not hold and caps pins at two", () => {
        const out = sanitizeStarters(
            {
                starters: [
                    {
                        question: "What are the renewal terms in the Globex MSA?",
                        hint: "from the MSA",
                        documentIds: [17, 999, 16, 17, 3],
                    },
                ],
            },
            BRIEF
        );
        expect(out).toHaveLength(1);
        expect(out[0]!.documentIds).toEqual([17, 16]);
    });

    it("strips numbering, dedupes near-identical questions, and keeps four at most", () => {
        const out = sanitizeStarters(
            {
                starters: [
                    { question: "1. Summarize the Globex MSA", hint: "", documentIds: [17] },
                    { question: "Summarize the Globex MSA!", hint: "again", documentIds: [] },
                    { question: "- What does PickBot v3 change?", hint: "spec", documentIds: [16] },
                    {
                        question: "Which contracts renew this quarter?",
                        hint: "contracts",
                        documentIds: [],
                    },
                    { question: "Who signed the HR policies?", hint: "HR folder", documentIds: [] },
                    { question: "What is our headcount plan?", hint: "HR", documentIds: [] },
                ],
            },
            BRIEF
        );
        expect(out.map(s => s.question)).toEqual([
            "Summarize the Globex MSA",
            "What does PickBot v3 change?",
            "Which contracts renew this quarter?",
            "Who signed the HR policies?",
        ]);
        // A missing hint falls back to the pinned document's title.
        expect(out[0]!.hint).toBe("from Globex MSA 2026");
    });

    it("reads document titles without their file extension", () => {
        const out = sanitizeStarters(
            {
                starters: [
                    {
                        question: "Summarize the obligations in Globex MSA 2026.pdf.",
                        hint: "from the MSA",
                        documentIds: [17],
                    },
                ],
            },
            BRIEF
        );
        expect(out[0]!.question).toBe("Summarize the obligations in Globex MSA 2026.");
    });

    it("discards fragments that are not questions", () => {
        const out = sanitizeStarters(
            { starters: [{ question: "MSA?", hint: "", documentIds: [] }] },
            BRIEF
        );
        expect(out).toEqual([]);
    });
});

describe("completeStarters", () => {
    it("pads a short set with fallbacks that do not repeat it", () => {
        const generated = sanitizeStarters(
            {
                starters: [
                    { question: 'Summarize "Globex MSA 2026"', hint: "the MSA", documentIds: [17] },
                ],
            },
            BRIEF
        );
        const out = completeStarters(generated, BRIEF);
        expect(out).toHaveLength(4);
        expect(out[0]!.question).toBe('Summarize "Globex MSA 2026"');
        // The fallback's own "Summarize …" duplicate was skipped, not doubled.
        expect(out.filter(s => s.question.startsWith("Summarize"))).toHaveLength(1);
        expect(new Set(out.map(s => s.id)).size).toBe(4);
    });
});

describe("fallbackStarters", () => {
    it("names the newest document, the biggest folder, and the company", () => {
        const out = fallbackStarters(BRIEF);
        expect(out).toHaveLength(4);
        expect(out[0]).toMatchObject({
            question: 'Summarize "Globex MSA 2026"',
            hint: "added 2 days ago",
            documentIds: [17],
        });
        expect(out[1]!.question).toBe("What are the key dates and deadlines in Contracts?");
        expect(out[2]!.question).toBe("What does Acme Robotics do, according to these sources?");
        expect(out[2]!.hint).toBe("across 42 sources");
    });

    it("still yields four sendable questions for an empty workspace", () => {
        const out = fallbackStarters({
            ...BRIEF,
            company: { name: null, description: null, industry: null, size: null },
            profileText: null,
            sourceCount: 0,
            folders: [],
            recentDocuments: [],
        });
        expect(out).toHaveLength(4);
        expect(out.every(s => s.documentIds.length === 0)).toBe(true);
        expect(out[0]!.question).toBe("What does this company do, according to these sources?");
        expect(out[0]!.hint).toBe("add a source to ground the answer");
    });
});

describe("buildStarterPrompt", () => {
    it("lays out the evidence and the questions to avoid", () => {
        const prompt = buildStarterPrompt(BRIEF, { avoid: ["Summarize the Globex MSA"] });
        expect(prompt).toContain("Name: Acme Robotics");
        expect(prompt).toContain("Industry: Industrial automation");
        expect(prompt).toContain("PickBot: robotic picking");
        expect(prompt).toContain("42 sources indexed.");
        expect(prompt).toContain("Folders: Contracts (12), HR (8)");
        expect(prompt).toContain("Connected systems: google-drive");
        expect(prompt).toContain("17 · Globex MSA 2026.pdf · Contracts · 2 days ago");
        expect(prompt).toContain("- Summarize the Globex MSA");
    });

    it("says so when nothing has been extracted or uploaded", () => {
        const prompt = buildStarterPrompt({
            ...BRIEF,
            profileText: null,
            recentDocuments: [],
            folders: [],
            connections: [],
            sourceCount: 0,
        });
        expect(prompt).toContain("No profile has been extracted yet.");
        expect(prompt).toContain("0 sources indexed.");
        expect(prompt).toContain("None yet.");
        expect(prompt).not.toContain("Already shown");
    });
});

describe("hasEvidence", () => {
    it("is false only when there is nothing to ground a question in", () => {
        expect(hasEvidence(BRIEF)).toBe(true);
        expect(
            hasEvidence({
                ...BRIEF,
                profileText: null,
                sourceCount: 0,
                company: { ...BRIEF.company, description: "  " },
            })
        ).toBe(false);
        expect(hasEvidence({ ...BRIEF, profileText: null, sourceCount: 0 })).toBe(true);
    });
});

describe("helpers", () => {
    it("displayTitle drops the extension and clips at a word", () => {
        expect(displayTitle("Globex MSA 2026.pdf")).toBe("Globex MSA 2026");
        expect(displayTitle("A very long document title that keeps going and going.docx", 24)).toBe(
            "A very long document…"
        );
    });

    it("relativeAge reads like the workspace rail", () => {
        const now = new Date("2026-09-02T12:00:00Z");
        expect(relativeAge(new Date("2026-09-02T11:30:00Z"), now)).toBe("just now");
        expect(relativeAge(new Date("2026-09-02T08:00:00Z"), now)).toBe("4h ago");
        expect(relativeAge(new Date("2026-09-01T08:00:00Z"), now)).toBe("yesterday");
        expect(relativeAge(new Date("2026-08-30T08:00:00Z"), now)).toBe("3 days ago");
        expect(relativeAge(new Date("2026-08-24T08:00:00Z"), now)).toBe("last week");
    });
});
