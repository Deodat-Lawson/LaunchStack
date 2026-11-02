/**
 * The adapter is where records become what a screen reads: deadlines in
 * days, readiness on every row, the to-do list in urgency order. Pure, so
 * these pin the words the screens rely on without a database.
 */
import {
    buildTodo,
    byDeadline,
    sourceHref,
    toApplicationRow,
    toEvidenceDto,
    toRunDto,
} from "~/server/proposals/adapter";
import type {
    ApplicationRecord,
    RunRecord,
    SectionRecord,
} from "@launchstack/pipelines/proposals/types";
import type { ApplicationRow, FunderRow } from "~/app/employer/tools/proposals/api";

const NOW = new Date("2026-06-01T12:00:00Z");

function application(partial: Partial<ApplicationRecord> = {}): ApplicationRecord {
    return {
        id: "a1",
        companyId: 1n,
        opportunityId: null,
        title: "Meyer 2026",
        funder: "Meyer",
        status: "in_progress",
        deadline: "2026-06-05",
        ownerUserId: "u",
        requestText: null,
        requestUrl: null,
        requestDocumentId: null,
        extracted: null,
        requirements: [],
        review: null,
        readiness: 40,
        notes: null,
        exportedDocumentId: null,
        submittedAt: null,
        createdByUserId: "u",
        createdAt: NOW,
        updatedAt: null,
        ...partial,
    };
}

function section(status: SectionRecord["status"], required = true): SectionRecord {
    return {
        id: `s-${status}-${Math.random()}`,
        companyId: 1n,
        applicationId: "a1",
        position: 0,
        key: status,
        question: status,
        guidance: null,
        wordLimit: null,
        required,
        status,
        draft: status === "empty" ? null : "text",
        draftMeta: null,
        createdAt: NOW,
        updatedAt: null,
    };
}

function row(partial: Partial<ApplicationRow> & { id: string }): ApplicationRow {
    return {
        title: partial.id,
        funder: null,
        status: "in_progress",
        deadline: null,
        daysLeft: null,
        readiness: 0,
        sections: { total: 3, written: 1, approved: 0 },
        blockers: 0,
        updatedAt: NOW.toISOString(),
        ...partial,
    };
}

function funder(partial: Partial<FunderRow> & { id: string }): FunderRow {
    return {
        source: "grants_gov",
        title: partial.id,
        funder: `Funder ${partial.id}`,
        url: null,
        summary: null,
        closesOn: null,
        daysLeft: null,
        status: "candidate",
        amountMin: null,
        amountMax: null,
        eligibility: null,
        fit: null,
        why: [],
        concerns: [],
        applicationId: null,
        foundAt: NOW.toISOString(),
        ...partial,
    };
}

describe("rows", () => {
    it("counts sections, days to the deadline and blockers on a row", () => {
        const r = toApplicationRow(
            application({
                review: {
                    readiness: 50,
                    summary: "",
                    reviewedAt: NOW.toISOString(),
                    findings: [
                        {
                            id: "b",
                            severity: "blocker",
                            kind: "missing",
                            sectionKey: null,
                            message: "",
                            suggestion: null,
                        },
                        {
                            id: "w",
                            severity: "warning",
                            kind: "weak",
                            sectionKey: null,
                            message: "",
                            suggestion: null,
                        },
                    ],
                },
            }),
            [section("approved"), section("drafted"), section("empty")],
            NOW
        );
        expect(r.daysLeft).toBe(4);
        expect(r.sections).toEqual({ total: 3, written: 2, approved: 1 });
        expect(r.blockers).toBe(1);
        expect(toApplicationRow(application({ deadline: null }), [], NOW).daysLeft).toBeNull();
    });

    it("links workspace evidence to the Studio and leaves web evidence alone", () => {
        expect(sourceHref(12)).toBe("/employer/documents?source=d12");
        expect(
            toEvidenceDto({ n: 1, documentId: 12, title: "t", page: 2, quote: "q", url: null }).href
        ).toBe("/employer/documents?source=d12");
        expect(
            toEvidenceDto({
                n: 1,
                documentId: null,
                title: "t",
                page: null,
                quote: "q",
                url: "https://x",
            }).href
        ).toBeNull();
    });

    it("turns a run row into the sheet's shape", () => {
        const run: RunRecord = {
            id: "r1",
            companyId: 1n,
            kind: "draft",
            status: "completed",
            applicationId: "a1",
            userId: "u",
            input: {},
            steps: [{ id: "draft:0", label: "Need", status: "done", detail: "2 citations" }],
            summary: { headline: "1 section drafted" },
            error: null,
            creditsUsed: 1500,
            createdAt: NOW,
            startedAt: NOW,
            completedAt: NOW,
            updatedAt: null,
        };
        expect(toRunDto(run)).toMatchObject({
            id: "r1",
            kind: "draft",
            headline: "1 section drafted",
            credits: 1500,
            steps: [{ id: "draft:0", status: "done", detail: "2 citations" }],
        });
    });
});

describe("ordering and to-do", () => {
    it("sorts dated rows first, nearest deadline first", () => {
        const sorted = byDeadline([
            row({ id: "none" }),
            row({ id: "late", deadline: "2026-07-01" }),
            row({ id: "soon", deadline: "2026-06-03" }),
        ]);
        expect(sorted.map(r => r.id)).toEqual(["soon", "late", "none"]);
    });

    it("puts the profile first, then deadlines this week, strong funders, then unwritten sections", () => {
        const todo = buildTodo({
            profileReady: false,
            sources: 3,
            applications: [
                row({
                    id: "due",
                    title: "Meyer",
                    deadline: "2026-06-03",
                    daysLeft: 2,
                    readiness: 60,
                    sections: { total: 5, written: 3, approved: 1 },
                }),
                row({
                    id: "later",
                    title: "ED",
                    deadline: "2026-08-01",
                    daysLeft: 61,
                    sections: { total: 4, written: 1, approved: 0 },
                }),
                row({
                    id: "done",
                    title: "OCF",
                    status: "awarded",
                    sections: { total: 1, written: 0, approved: 0 },
                }),
            ],
            funders: [
                funder({ id: "f1", fit: 85 }),
                funder({ id: "f2", fit: 85, status: "saved" }),
                funder({ id: "f3", fit: 40 }),
            ],
            href: p => `/g${p}`,
        });
        expect(todo.map(t => t.id)).toEqual([
            "profile",
            "deadline:due",
            "funders",
            "sections:later",
        ]);
        expect(todo[1]!.title).toBe("Meyer is due in 2 days");
        expect(todo[2]!.title).toBe("1 strong-fit funder to decide on");
        expect(todo[3]!.title).toBe("3 sections to write for ED");
        expect(todo[3]!.action.href).toBe("/g/write/later");
    });

    it("says nothing when there is nothing to do", () => {
        expect(
            buildTodo({
                profileReady: true,
                sources: 0,
                applications: [],
                funders: [],
                href: p => p,
            })
        ).toEqual([]);
    });
});
