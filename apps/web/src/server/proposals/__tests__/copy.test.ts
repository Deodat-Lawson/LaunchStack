/**
 * The sentences a proposals run and review store in English reach the screen
 * with a copy beside them, so a Chinese reader sees Chinese while the stored
 * English — and every other API reader's — stays exactly as it was. The
 * English here comes from the pipeline's own templates, so a template that
 * changes upstream shows up as a missing copy, not as wrong words.
 */
import {
    deterministicFindings,
    requirementsFromExtracted,
    stepsFor,
    type ApplicationRecord,
    type RunRecord,
    type SectionRecord,
} from "@launchstack/pipelines/proposals";

import type { Copy } from "~/i18n/copy";
import { englishCopy, wordCopy } from "~/i18n/translate";
import { toApplicationDetail, toRunDto } from "~/server/proposals/adapter";
import { ProposalsError } from "~/server/proposals/service";
import { InsufficientCreditsError } from "~/server/proposals/executor";

jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("~/lib/storage", () => ({ uploadFile: jest.fn() }));
jest.mock("~/server/services/document-upload", () => ({ processDocumentUpload: jest.fn() }));
jest.mock("~/server/inngest/client", () => ({ inngest: { send: jest.fn() } }));

const NOW = new Date("2026-06-01T12:00:00Z");

const zh = (copy: Copy | undefined) => (copy ? wordCopy(copy, "zh-CN") : undefined);

function run(partial: Partial<RunRecord>): RunRecord {
    return {
        id: "r1",
        companyId: 1n,
        kind: "review",
        status: "completed",
        applicationId: "a1",
        userId: "u",
        input: {},
        steps: [],
        summary: null,
        error: null,
        creditsUsed: 0,
        createdAt: NOW,
        startedAt: NOW,
        completedAt: NOW,
        updatedAt: null,
        ...partial,
    };
}

function application(partial: Partial<ApplicationRecord> = {}): ApplicationRecord {
    return {
        id: "a1",
        companyId: 1n,
        opportunityId: null,
        title: "Meyer 2026",
        funder: "Meyer",
        status: "in_review",
        deadline: "2026-05-30",
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

function section(partial: Partial<SectionRecord>): SectionRecord {
    return {
        id: "s1",
        companyId: 1n,
        applicationId: "a1",
        position: 0,
        key: "need",
        question: "Describe the need",
        guidance: null,
        wordLimit: null,
        required: true,
        status: "empty",
        draft: null,
        draftMeta: null,
        createdAt: NOW,
        updatedAt: null,
        ...partial,
    } as SectionRecord;
}

describe("run copy", () => {
    it("words every step label a run of each kind starts with, except a draft step's question", () => {
        for (const kind of ["funders", "extract", "review"] as const) {
            const dto = toRunDto(run({ kind, steps: stepsFor(kind, {}) }));
            for (const step of dto.steps) {
                expect(step.labelCopy).toBeDefined();
                expect(englishCopy(step.labelCopy!)).toBe(step.label);
            }
        }
        const draft = toRunDto(
            run({ kind: "draft", steps: stepsFor("draft", {}, ["Describe the need"]) })
        );
        expect(draft.steps[0]!.label).toBe("Describe the need");
        expect(draft.steps[0]!.labelCopy).toBeUndefined();

        const rewrite = toRunDto(
            run({ kind: "rewrite", steps: stepsFor("rewrite", {}, ["Describe the need"]) })
        );
        expect(zh(rewrite.steps[0]!.labelCopy)).toBe("改写：Describe the need");
    });

    it("says a finished run's step details and headline in Chinese, keeping the English", () => {
        const dto = toRunDto(
            run({
                kind: "funders",
                steps: [
                    {
                        id: "plan",
                        label: "Planning the search",
                        status: "done",
                        detail: "youth, literacy",
                    },
                    {
                        id: "search",
                        label: "Searching Grants.gov and the web",
                        status: "done",
                        detail: "Grants.gov: 12 · Web: off",
                    },
                    { id: "score", label: "Scoring fit", status: "done", detail: "not scored" },
                    { id: "save", label: "Saving funders", status: "done", detail: "12 funders" },
                ],
                summary: { headline: "12 funders found, 3 strong fits" },
            })
        );
        expect(dto.headline).toBe("12 funders found, 3 strong fits");
        expect(zh(dto.headlineCopy)).toBe("找到 12 个资助方，其中 3 个高度契合");
        expect(dto.steps.map(s => zh(s.detailCopy))).toEqual([
            undefined, // the planned keywords are the model's words
            "Grants.gov：12 个 · 网页：未启用",
            "未评分",
            "12 个资助方",
        ]);
        expect(zh(dto.steps[0]!.labelCopy)).toBe("规划搜索");
    });

    it("handles plurals and grouped numbers as the English printed them", () => {
        const dto = toRunDto(
            run({
                kind: "extract",
                steps: [
                    {
                        id: "read",
                        label: "Reading the request",
                        status: "done",
                        detail: "12,345 characters",
                    },
                    { id: "draft:0", label: "Q", status: "done", detail: "1 citation · 2 gaps" },
                ],
                summary: { headline: "Readiness 80/100 · 4 findings · 1 blocker" },
            })
        );
        expect(englishCopy(dto.steps[0]!.detailCopy!)).toBe("12,345 characters");
        expect(zh(dto.steps[0]!.detailCopy)).toBe("12,345 个字符");
        expect(zh(dto.steps[1]!.detailCopy)).toBe("1 处引用 · 2 处缺口");
        expect(zh(dto.headlineCopy)).toBe("就绪度 80/100 · 4 条审阅意见 · 1 个阻断问题");
    });

    it("words the run's own failure, and leaves a provider's as it came", () => {
        const own = toRunDto(
            run({
                status: "failed",
                error: "The request is too short to read anything from.",
                steps: [
                    {
                        id: "extract",
                        label: "Extracting requirements",
                        status: "failed",
                        detail: "The request is too short to read anything from.",
                    },
                ],
            })
        );
        expect(zh(own.errorCopy)).toBe("征集要求太短，读不出任何内容。");
        expect(zh(own.steps[0]!.detailCopy)).toBe("征集要求太短，读不出任何内容。");

        const provider = toRunDto(run({ status: "failed", error: "429 Too Many Requests" }));
        expect(provider.error).toBe("429 Too Many Requests");
        expect(provider.errorCopy).toBeUndefined();
    });

    it("drops the copy when the stored English does not match its template", () => {
        const dto = toRunDto(run({ summary: { headline: "12 funders found (3 strong)" } }));
        expect(dto.headlineCopy).toBeUndefined();
    });
});

describe("review and checklist copy", () => {
    const sections = [
        section({ key: "need", question: "Describe the need", status: "empty" }),
        section({
            id: "s2",
            key: "budget",
            question: "Budget narrative",
            status: "drafted",
            draft: Array.from({ length: 130 }, () => "word").join(" "),
            wordLimit: 100,
            draftMeta: { cites: [], gaps: [], evidence: [], libraryItemIds: [] },
        } as Partial<SectionRecord>),
    ];
    const requirements = requirementsFromExtracted({
        title: null,
        funder: null,
        summary: null,
        deadline: "2026-06-15",
        amountMin: 10000,
        amountMax: 50000,
        eligibility: ["Registered 501(c)(3)"],
        sections: [
            {
                key: "need",
                question: "Describe the need",
                guidance: null,
                wordLimit: 500,
                required: true,
            },
            {
                key: "extra",
                question: "Anything else?",
                guidance: null,
                wordLimit: null,
                required: false,
            },
        ],
        attachments: ["Audited accounts"],
        format: [],
    });
    const findings = deterministicFindings({
        application: { deadline: "2026-05-30", requirements },
        sections,
        now: NOW,
    });
    const record = application({
        requirements,
        review: {
            readiness: 30,
            summary: "Nothing has been written yet.",
            findings: [
                ...findings,
                {
                    id: "model:vague:need:0",
                    severity: "warning",
                    kind: "vague",
                    sectionKey: "need",
                    message: "The need is stated without numbers.",
                    suggestion: "Add the waitlist count.",
                },
            ],
            reviewedAt: NOW.toISOString(),
        },
    } as Partial<ApplicationRecord>);
    const detail = toApplicationDetail(record, sections, NOW);

    it("words every deterministic finding and keeps the model's own", () => {
        const review = detail.review!;
        expect(zh(review.summaryCopy)).toBe("还没有写任何内容。");
        const own = review.findings.filter(f => !f.id.startsWith("model:"));
        expect(own.length).toBeGreaterThanOrEqual(5);
        for (const f of own) {
            expect(f.messageCopy).toBeDefined();
            expect(englishCopy(f.messageCopy!)).toBe(f.message);
            if (f.suggestion) expect(englishCopy(f.suggestionCopy!)).toBe(f.suggestion);
        }
        const byId = new Map(review.findings.map(f => [f.id, f]));
        expect(zh(byId.get("missing:need")!.messageCopy)).toBe("“Describe the need”还没有回答。");
        expect(zh(byId.get("over_limit:budget")!.messageCopy)).toBe("共 130 词，限制为 100 词。");
        expect(zh(byId.get("deadline:passed")!.messageCopy)).toBe("截止日期已过去 2 天。");
        const model = byId.get("model:vague:need:0")!;
        expect(model.messageCopy).toBeUndefined();
        expect(model.suggestionCopy).toBeUndefined();
    });

    it("words the checklist rows the server composed, not the funder's own", () => {
        const rows = new Map(detail.requirements.map(r => [r.id, r]));
        expect(zh(rows.get("deadline")!.textCopy)).toBe("在 2026-06-15 前提交");
        expect(rows.get("budget")!.text).toBe("Request between $10,000 and $50,000");
        expect(zh(rows.get("budget")!.textCopy)).toBe("申请金额在 $10,000 至 $50,000 之间");
        expect(zh(rows.get("section:need")!.textCopy)).toBe("回答：Describe the need（500 词）");
        expect(zh(rows.get("section:extra")!.textCopy)).toBe("可选：Anything else?");
        const eligibility = detail.requirements.find(r => r.kind === "eligibility")!;
        expect(eligibility.text).toBe("Registered 501(c)(3)");
        expect(eligibility.textCopy).toBeUndefined();
    });
});

describe("errors", () => {
    it("carry their English as the message and a copy to word", () => {
        const error = new ProposalsError({ key: "proposals.server.errors.sectionNotFound" }, 404);
        expect(error.message).toBe("Section not found");
        expect(zh(error.copy ?? undefined)).toBe("找不到这个章节");
        const credits = new InsufficientCreditsError(5);
        expect(credits.message).toBe("Not enough credits to start this run");
        expect(zh(credits.copy)).toBe("额度不足，无法开始这次运行");
    });
});
