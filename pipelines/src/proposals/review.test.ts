import { describe, expect, it } from "vitest";

import {
    computeReadiness,
    deterministicFindings,
    mergeFindings,
    overLimit,
    syncSectionRequirements,
} from "./review";
import type { Requirement, ReviewFinding, SectionRecord } from "./types";

const NOW = new Date("2026-06-01T12:00:00Z");

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

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

describe("readiness", () => {
    it("is zero with nothing, full with everything approved and ticked", () => {
        expect(computeReadiness({ sections: [], requirements: [] })).toBe(0);
        const done: Requirement[] = [
            { id: "e1", kind: "eligibility", text: "x", done: true, sectionKey: null },
            { id: "s:a", kind: "section", text: "x", done: true, sectionKey: "a" },
        ];
        expect(
            computeReadiness({
                sections: [section({ key: "a", status: "approved", draft: "ok" })],
                requirements: done,
            })
        ).toBe(100);
    });

    it("weights required sections at 70% and the checklist at 30%", () => {
        const requirements: Requirement[] = [
            { id: "e1", kind: "eligibility", text: "x", done: false, sectionKey: null },
            { id: "e2", kind: "attachment", text: "y", done: true, sectionKey: null },
        ];
        const sections = [
            section({ key: "a", status: "drafted", draft: "ok" }),
            section({ key: "b", status: "approved", draft: "ok" }),
            section({ key: "c", status: "empty", required: false }),
        ];
        // sections: (0.6 + 1) / 2 = 0.8 → 56; checklist: 1/2 → 15
        expect(computeReadiness({ sections, requirements })).toBe(71);
    });

    it("caps an over-limit draft at a raw draft's credit", () => {
        const s = section({ key: "a", status: "approved", wordLimit: 10, draft: words(12) });
        expect(overLimit(s)).toBe(true);
        expect(computeReadiness({ sections: [s], requirements: [] })).toBe(60);
        expect(overLimit(section({ key: "b", wordLimit: 10, draft: words(11) }))).toBe(false);
    });
});

describe("deterministic findings", () => {
    it("flags empty required sections, over-limit drafts, unsupported drafts, unticked eligibility and the deadline", () => {
        const findings = deterministicFindings({
            application: {
                deadline: "2026-05-30",
                requirements: [
                    {
                        id: "e1",
                        kind: "eligibility",
                        text: "Be a nonprofit",
                        done: false,
                        sectionKey: null,
                    },
                    { id: "a1", kind: "attachment", text: "Budget", done: false, sectionKey: null },
                ],
            },
            sections: [
                section({ key: "need", status: "empty" }),
                section({
                    key: "plan",
                    status: "drafted",
                    wordLimit: 5,
                    draft: words(9),
                    draftMeta: { cites: [], gaps: [], evidence: [], libraryItemIds: [] },
                }),
                section({ key: "extra", status: "empty", required: false }),
            ],
            now: NOW,
        });
        expect(findings.map(f => f.id)).toEqual([
            "missing:need",
            "over_limit:plan",
            "unsupported:plan",
            "eligibility:e1",
            "attachment:a1",
            "deadline:passed",
        ]);
        expect(findings[0]!.severity).toBe("blocker");
        expect(findings.at(-1)!.message).toBe("The deadline passed 2 days ago.");
    });

    it("warns when the deadline is within three days", () => {
        const findings = deterministicFindings({
            application: { deadline: "2026-06-03", requirements: [] },
            sections: [],
            now: NOW,
        });
        expect(findings).toEqual([
            expect.objectContaining({ id: "deadline:soon", message: "2 days to the deadline." }),
        ]);
    });
});

describe("merging and syncing", () => {
    it("puts blockers first and drops a model finding that repeats a deterministic one", () => {
        const base: ReviewFinding[] = [
            {
                id: "x",
                severity: "note",
                kind: "unsupported",
                sectionKey: "a",
                message: "m",
                suggestion: null,
            },
        ];
        const extra: ReviewFinding[] = [
            {
                id: "m1",
                severity: "note",
                kind: "unsupported",
                sectionKey: "a",
                message: "dup",
                suggestion: null,
            },
            {
                id: "m2",
                severity: "blocker",
                kind: "weak",
                sectionKey: "b",
                message: "weak",
                suggestion: null,
            },
        ];
        expect(mergeFindings(base, extra).map(f => f.id)).toEqual(["m2", "x"]);
    });

    it("mirrors section status onto section checklist rows only", () => {
        const rows: Requirement[] = [
            { id: "s:a", kind: "section", text: "a", done: false, sectionKey: "a" },
            { id: "e", kind: "eligibility", text: "e", done: true, sectionKey: null },
        ];
        const synced = syncSectionRequirements(rows, [{ key: "a", status: "approved" }]);
        expect(synced[0]!.done).toBe(true);
        expect(synced[1]!.done).toBe(true);
    });
});
