/**
 * Prospects' server-written text in the reader's language. Every copy the
 * adapter sends must say exactly its English field in English (API readers
 * keep that field; the screens word the copy), and read as Chinese in
 * zh-CN. Route errors are worded where the route answers.
 */
import type {
    ProgramRecord,
    RelationshipEventRecord,
    RelationshipRecord,
    RunRecord,
} from "@launchstack/pipelines/distribution/types";
import { assertTransition } from "@launchstack/pipelines/distribution/stages";

jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: jest.fn(),
}));

import { copy, type Copy } from "~/i18n/copy";
import { wordCopy } from "~/i18n/translate";
import { handleProspectsError } from "~/app/api/prospects/_http";
import {
    allowedMoves,
    contactPeople,
    profileClaims,
    segmentFields,
    signalsFromEvents,
    sourceDetailCopy,
    sourceRows,
    toRunDto,
    toSegmentSummary,
} from "~/server/prospects/adapter";
import { ProspectsError } from "~/server/prospects/service";

const en = (c: Copy | null | undefined) => (c ? wordCopy(c, "en") : null);
const zh = (c: Copy | null | undefined) => (c ? wordCopy(c, "zh-CN") : null);

const rel = (over: Partial<RelationshipRecord> = {}): RelationshipRecord => ({
    id: "rel-1",
    companyId: 1n,
    programId: "prog-1",
    orgId: "org-1",
    kind: "distributor",
    territory: { country: "NL" },
    stage: "candidate",
    fitScore: 72,
    fitRationale: null,
    fitBreakdown: null,
    riskFlags: [],
    screening: null,
    dossier: null,
    ownerUserId: null,
    nextAction: null,
    nextActionAt: null,
    lastActivityAt: null,
    dossierDocumentId: null,
    source: "discovery",
    stageChangedAt: new Date("2026-09-10T10:00:00Z"),
    createdAt: new Date("2026-09-10T10:00:00Z"),
    updatedAt: null,
    ...over,
});

const program: ProgramRecord = {
    id: "prog-1",
    companyId: 1n,
    name: "EU fulfilment",
    offering: "Picking robots",
    categories: ["3PL"],
    hsCodes: [],
    targetTerritories: [{ country: "NL" }, { country: "DE" }, { country: "GB" }],
    partnerKinds: ["distributor", "retailer"],
    constraints: null,
    knownPartnerDomains: ["a.test", "b.test"],
    status: "active",
    createdByUserId: "u1",
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: null,
} as unknown as ProgramRecord;

const run = (over: Partial<RunRecord>): RunRecord => ({
    id: "run-1",
    companyId: 1n,
    programId: "prog-1",
    userId: "u1",
    status: "completed",
    options: { maxCandidates: 25, mode: "keyless" },
    plan: null,
    summary: {
        sources: [
            { source: "web", queries: 4, results: 1200, status: "ok" },
            {
                source: "place",
                queries: 3,
                results: 4,
                status: "degraded",
                detail: "2 queries failed",
            },
            {
                source: "trade",
                queries: 0,
                results: 0,
                status: "skipped",
                detail: "trade data not configured",
            },
        ],
        mentions: 15,
        resolved: 6,
        excluded: 1,
        shortlisted: 6,
        enriched: 5,
        gateRejections: 1,
        budgetExhausted: 0,
        screened: 6,
        flagged: 0,
        published: 5,
        degraded: true,
        warnings: [],
        tokens: { input: 0, output: 0, total: 0 },
        wallMs: 1000,
    },
    candidateOrgIds: ["o1"],
    creditsUsed: 0,
    errorMessage: null,
    createdAt: new Date("2026-09-17T09:00:00Z"),
    startedAt: new Date("2026-09-17T09:00:00Z"),
    completedAt: new Date("2026-09-17T09:04:00Z"),
    ...over,
});

describe("adapter copies say their English field exactly", () => {
    it("for a run's steps, figures and caps", () => {
        for (const dto of [
            toRunDto(run({})),
            toRunDto(run({ status: "enriching", summary: null }), {
                profiled: 1,
                shortlisted: 3,
            }),
            toRunDto(
                run({
                    status: "gathering",
                    summary: null,
                    options: { maxCandidates: 25, mode: "fixture" },
                })
            ),
        ]) {
            const steps = dto.steps.flatMap(s => [s, ...(s.children ?? [])]);
            for (const step of steps) {
                expect(en(step.labelCopy)).toBe(step.label);
                if (step.detailCopy) expect(en(step.detailCopy)).toBe(step.detail);
                expect(en(step.rightCopy) ?? null).toBe(step.right);
            }
            expect(en(dto.capsCopy)).toBe(dto.caps);
            for (const y of dto.summary?.sources ?? []) {
                expect(en(y.labelCopy)).toBe(y.label);
                if (y.detailCopy) expect(en(y.detailCopy)).toBe(y.detail);
            }
        }
    });

    it("for every stage move's reason", () => {
        for (const stage of [
            "candidate",
            "contacted",
            "in_conversation",
            "proposal",
            "negotiating",
            "contracted",
            "declined",
            "dormant",
        ] as const) {
            for (const hasAgreement of [true, false]) {
                for (const move of allowedMoves(rel({ stage }), hasAgreement)) {
                    expect(en(move.reasonCopy)).toBe(move.reason);
                }
            }
        }
    });

    it("for segment fields, subtitle words and sources", () => {
        for (const field of segmentFields(program)) {
            expect(en(field.labelCopy)).toBe(field.label);
            expect(field.sourcesCopy?.map(en)).toEqual(field.sources);
            if (Array.isArray(field.valueCopy))
                expect(field.valueCopy.map(en)).toEqual(field.value);
            else if (field.valueCopy) expect(en(field.valueCopy)).toBe(field.value);
        }
        const summary = toSegmentSummary(program, [], 3);
        expect(summary.words).toEqual({
            kinds: [
                copy("growth.server.segment.kind", { kind: "distributor" }),
                copy("growth.server.segment.kind", { kind: "retailer" }),
            ],
            countries: ["NL", "DE", "GB"],
        });
        for (const row of sourceRows(
            { web: true, place: false, trade: false, screening: true },
            null
        )) {
            expect(en(row.labelCopy)).toBe(row.label);
            expect(en(row.descriptionCopy)).toBe(row.description);
            expect(en(row.costCopy)).toBe(row.cost);
        }
    });

    it("for timeline lines, why-fit lines and people", () => {
        const events = [
            { type: "researched", payload: { fitScore: 64, evidence: 3 } },
            { type: "meeting", payload: { summary: "Intro call" } },
            { type: "reply_logged", payload: {} },
            { type: "document_shared", payload: { title: "Deck" } },
            { type: "agreement_signed", payload: {} },
            { type: "imported", payload: { stage: "active" } },
            { type: "imported", payload: {} },
        ].map(
            (e, i) =>
                ({
                    id: `e${i}`,
                    occurredAt: new Date("2026-09-12T10:00:00Z"),
                    ...e,
                }) as unknown as RelationshipEventRecord
        );
        const signals = signalsFromEvents(events);
        expect(signals).toHaveLength(6);
        for (const s of signals) {
            expect(en(s.copy)).toBe(s.text);
            expect(s.at).toBe("2026-09-12T10:00:00.000Z");
        }

        const claims = profileClaims(
            rel({
                riskFlags: ["thin evidence", "Sells a competing line"],
                screening: { status: "flagged", flags: [{ matchedName: "ACME" }] },
            } as Partial<RelationshipRecord>),
            []
        );
        expect(claims.whyFit.map(c => en(c.copy))).toEqual(claims.whyFit.map(c => c.text));
        expect(claims.whyFit.map(c => zh(c.copy))).toEqual([
            "风险：证据不足",
            "风险：Sells a competing line",
            "风险：合规筛查标记了 ACME（仅供参考）。",
        ]);

        const people = contactPeople(
            rel({
                dossier: {
                    contactChannels: [
                        { channel: "email", value: "info@example.test" },
                        { channel: "email", value: "jan@example.test" },
                    ],
                } as RelationshipRecord["dossier"],
            }),
            { id: "org-1", name: "Example BV", domain: "example.test" } as never,
            "Company excluded: Excluded from runs",
            copy("growth.server.companies.blockedExcludedFromRuns")
        );
        for (const p of people) {
            expect(en(p.nameCopy) ?? p.name).toBe(p.name);
            expect(en(p.titleCopy) ?? p.title).toBe(p.title);
            expect(en(p.sourceCopy)).toBe(p.source);
            expect(en(p.blockedReasonCopy)).toBe(p.blockedReason);
        }
        expect(zh(people[0]!.titleCopy)).toBe("共享邮箱");
    });
});

describe("in Chinese", () => {
    it("words a run's steps", () => {
        const dto = toRunDto(run({}));
        const sources = dto.steps.find(s => s.id === "sources")!;
        expect(zh(sources.labelCopy)).toBe("来源");
        expect(zh(sources.detailCopy)).toBe("已完成 1/2");
        expect(sources.children!.map(c => zh(c.labelCopy))).toEqual([
            "公开目录（YC）",
            "OpenStreetMap",
            "贸易数据",
        ]);
        expect(zh(sources.children![0]!.rightCopy)).toBe("找到 1200 个");
        expect(zh(sources.children![1]!.detailCopy)).toBe("2 个查询失败");
        expect(zh(dto.capsCopy)).toBe("25 个候选 · 公开来源，无需密钥");
        expect(zh(dto.steps.find(s => s.id === "people")!.detailCopy)).toBe(
            "将随联系人查找功能推出"
        );
        expect(sourceDetailCopy("Exa returned 500")).toBeNull();
    });

    it("words why a stage move is refused", () => {
        const reasons = Object.fromEntries(
            allowedMoves(rel({ stage: "candidate" }), false).map(m => [m.stage, zh(m.reasonCopy)])
        );
        expect(reasons.lead).toBe("当前阶段");
        expect(reasons.proposal).toBe("请先移至“已联系”");
        expect(reasons.qualified).toBe("请先移至“已联系”");
        expect(reasons.contacted).toBe("需要指定负责人");
        expect(reasons.lost).toBeNull();
    });
});

describe("route errors", () => {
    const zhRequest = new Request("http://localhost/api/prospects/home", {
        headers: { cookie: "ls-locale=zh-CN.1" },
    });
    const enRequest = new Request("http://localhost/api/prospects/home");

    it("words a ProspectsError and the copies in its extra fields", async () => {
        const err = new ProspectsError(
            copy("growth.server.errors.cannotMoveTo", { stage: "proposal" }),
            409,
            { reason: copy("growth.server.moves.notAStage") }
        );
        expect(err.message).toBe("Cannot move to proposal");
        const zhBody = await handleProspectsError("PATCH deal", err, zhRequest).json();
        expect(zhBody).toEqual({ error: "无法移至“提案”", reason: "此工作区暂未启用该阶段" });
        const enBody = await handleProspectsError("PATCH deal", err, enRequest).json();
        expect(enBody).toEqual({
            error: "Cannot move to proposal",
            reason: "Not a stage in this workspace yet",
        });
    });

    it("words a refused transition and its requirement", async () => {
        let refused: unknown;
        try {
            assertTransition({
                from: "researched",
                to: "contacted",
                context: { ownerUserId: null, nextAction: null, hasAgreement: false },
            });
        } catch (e) {
            refused = e;
        }
        const zhBody = await handleProspectsError("PATCH deal", refused, zhRequest).json();
        expect(zhBody).toEqual({
            error: "从“contacted”阶段起需要指定负责人（正在进入“contacted”）。",
            code: "owner_required",
            reason: "需要指定负责人",
        });
        const enBody = await handleProspectsError("PATCH deal", refused, enRequest).json();
        expect(enBody).toEqual({
            error: 'An owner is required from "contacted" onward (entering "contacted").',
            code: "owner_required",
            reason: "Needs an owner",
        });
    });
});
