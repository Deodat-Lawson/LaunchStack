/**
 * The adapter is how Prospects reads today's Distribution data. These tests
 * pin the parts a wrong mapping would silently break: which sales stage a
 * relationship shows as, which moves the stage menu offers and why the
 * others are disabled, how a run's status becomes the step list, and how a
 * dossier becomes cited claims.
 */
import type {
    EvidenceRecord,
    RelationshipRecord,
    RunRecord,
} from "@launchstack/pipelines/distribution/types";
import {
    SALES_OF,
    allowedMoves,
    contactPeople,
    moveReason,
    profileClaims,
    relationshipTarget,
    toRunDto,
    viewMatches,
} from "~/server/prospects/adapter";
import type { CompanyRow } from "~/app/employer/tools/growth/prospects/api";

const rel = (over: Partial<RelationshipRecord> = {}): RelationshipRecord => ({
    id: "rel-1",
    companyId: 1n,
    programId: "prog-1",
    orgId: "org-1",
    kind: "distributor",
    territory: { country: "NL" },
    stage: "candidate",
    fitScore: 72,
    fitRationale: "Strong category overlap.",
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

describe("stage mapping", () => {
    it("folds ten relationship stages onto the funnel", () => {
        expect(SALES_OF.candidate).toBe("lead");
        expect(SALES_OF.researched).toBe("lead");
        expect(SALES_OF.in_conversation).toBe("meeting");
        expect(SALES_OF.contracted).toBe("won");
        expect(SALES_OF.active).toBe("won");
        expect(SALES_OF.declined).toBe("lost");
        expect(SALES_OF.dormant).toBe("nurture");
    });

    it("picks a legal relationship stage for a sales move", () => {
        expect(relationshipTarget("contacted", "lead")).toBe("researched");
        expect(relationshipTarget("declined", "lead")).toBe("researched");
        expect(relationshipTarget("candidate", "won")).toBe("contracted");
        expect(relationshipTarget("candidate", "proposal")).toBeNull();
    });
});

describe("moves and reasons", () => {
    it("explains every disabled move in plain words", () => {
        const lead = rel();
        expect(moveReason(lead, false, "lead")).toBe("Current stage");
        expect(moveReason(lead, false, "contacted")).toBe("Needs an owner");
        expect(moveReason(lead, false, "qualified")).toBe("Move to Contacted first");
        expect(moveReason(lead, false, "proposal")).toBe("Not a stage in this workspace yet");
        expect(moveReason(lead, false, "lost")).toBeNull();
        expect(moveReason(lead, false, "nurture")).toBeNull();
    });

    it("lets an owned, planned deal move forward and keeps won deals won", () => {
        const owned = rel({ stage: "contacted", ownerUserId: "u1" });
        expect(moveReason(owned, false, "meeting")).toBe("Needs a next step");
        const planned = rel({ stage: "contacted", ownerUserId: "u1", nextAction: "Call" });
        expect(moveReason(planned, false, "meeting")).toBeNull();
        const negotiating = rel({ stage: "negotiating", ownerUserId: "u1", nextAction: "Sign" });
        expect(moveReason(negotiating, false, "won")).toBe(
            "Needs an agreement recorded in Distribution"
        );
        expect(moveReason(negotiating, true, "won")).toBeNull();
        const won = rel({ stage: "contracted", ownerUserId: "u1" });
        expect(moveReason(won, true, "meeting")).toBe("Won deals stay won");
        expect(moveReason(won, true, "nurture")).toBeNull();
    });

    it("returns one entry per sales stage", () => {
        const moves = allowedMoves(rel(), false);
        expect(moves.map(m => m.stage)).toEqual([
            "lead",
            "qualified",
            "contacted",
            "meeting",
            "proposal",
            "negotiating",
            "won",
            "lost",
            "nurture",
        ]);
    });
});

describe("profiles and people", () => {
    const evidence: EvidenceRecord[] = [
        {
            id: 42,
            companyId: 1n,
            orgId: "org-1",
            runId: null,
            kind: "brands_carried",
            claim: "Carries Brand A",
            sourceUrl: "https://example.test/brands",
            quote: "We proudly stock Brand A",
            confidence: 0.9,
            capturedAt: new Date(),
            provenance: null,
        },
        {
            id: 7,
            companyId: 1n,
            orgId: "org-1",
            runId: null,
            kind: "territory",
            claim: "Delivers across the Netherlands",
            sourceUrl: "https://example.test/delivery",
            quote: null,
            confidence: 0.8,
            capturedAt: new Date(),
            provenance: null,
        },
    ];

    it("numbers evidence in id order and maps dossier citations onto it", () => {
        const withDossier = rel({
            dossier: {
                summary: "A Dutch distributor of specialty food to independent retailers.",
                roles: ["distributor"],
                brandsCarried: [{ brand: "Brand A", evidenceIds: [42] }],
                territories: [{ territory: "Netherlands", evidenceIds: [7] }],
                retailCoverage: [],
                certifications: [],
                contactChannels: [
                    { channel: "email", value: "info@example.test", evidenceIds: [7] },
                    { channel: "email", value: "jan.devries@example.test", evidenceIds: [7] },
                ],
                decisionMakers: [],
                risks: [],
                sizeBand: "small",
                openQuestions: ["Minimum order quantity."],
            },
        });
        const claims = profileClaims(withDossier, evidence);
        expect(claims.evidence.map(e => e.n)).toEqual([1, 2]);
        expect(claims.evidence[0]!.url).toBe("https://example.test/delivery");
        expect(claims.about[1]).toEqual({ text: "Carries Brand A.", cites: [2] });
        expect(claims.about[2]).toEqual({ text: "Active in Netherlands.", cites: [1] });
        expect(claims.openQuestions).toEqual(["Minimum order quantity."]);

        const people = contactPeople(
            withDossier,
            {
                id: "org-1",
                companyId: 1n,
                resolveKey: "d:example.test",
                name: "Example BV",
                domain: "example.test",
                country: "NL",
                region: null,
                city: null,
                lat: null,
                lng: null,
                roles: [],
                categories: [],
                sizeBand: null,
                description: null,
                kgEntityId: null,
                firstSeenRunId: null,
                lastEnrichedAt: null,
                createdAt: new Date(),
                updatedAt: null,
            },
            null
        );
        expect(people.map(p => p.emailStatus)).toEqual(["generic", "found"]);
        expect(people[1]!.name).toBe("jan devries");
    });
});

describe("runs", () => {
    const run = (over: Partial<RunRecord>): RunRecord => ({
        id: "run-1",
        companyId: 1n,
        programId: "prog-1",
        userId: "u1",
        status: "gathering",
        options: { maxCandidates: 25, mode: "live" },
        plan: null,
        summary: null,
        candidateOrgIds: null,
        creditsUsed: 0,
        errorMessage: null,
        createdAt: new Date("2026-09-17T09:00:00Z"),
        startedAt: new Date("2026-09-17T09:00:00Z"),
        completedAt: null,
        ...over,
    });

    it("maps a live run's status onto the step list", () => {
        const dto = toRunDto(run({ status: "enriching" }));
        expect(dto.status).toBe("running");
        const by = Object.fromEntries(dto.steps.map(s => [s.id, s.status]));
        expect(by.sources).toBe("done");
        expect(by.shortlist).toBe("done");
        expect(by.profiles).toBe("running");
        expect(by.people).toBe("skipped");
    });

    it("shows the shortlist and profiling progress while a run is still enriching", () => {
        const dto = toRunDto(run({ status: "enriching", candidateOrgIds: ["o1", "o2", "o3"] }), {
            profiled: 1,
            shortlisted: 3,
        });
        const detail = Object.fromEntries(dto.steps.map(s => [s.id, s.detail]));
        expect(detail.shortlist).toBe("3 companies");
        expect(detail.profiles).toBe("1 of 3");
        expect(dto.summary).toBeNull();
        const early = toRunDto(run({ status: "gathering" }));
        expect(early.steps.find(s => s.id === "profiles")!.detail).toBe("0 of 25");
    });

    it("turns a completed run's source counts into yield rows", () => {
        const dto = toRunDto(
            run({
                status: "completed",
                completedAt: new Date("2026-09-17T09:04:12Z"),
                creditsUsed: 8,
                options: { maxCandidates: 25, mode: "fixture" },
                summary: {
                    sources: [
                        { source: "web", queries: 4, results: 12, status: "ok" },
                        {
                            source: "place",
                            queries: 0,
                            results: 0,
                            status: "skipped",
                            detail: "not configured",
                        },
                        { source: "trade", queries: 1, results: 3, status: "ok" },
                    ],
                    mentions: 15,
                    resolved: 6,
                    excluded: 1,
                    shortlisted: 6,
                    enriched: 6,
                    gateRejections: 0,
                    budgetExhausted: 0,
                    screened: 6,
                    flagged: 1,
                    published: 6,
                    degraded: false,
                    warnings: [],
                    tokens: { input: 0, output: 0, total: 0 },
                    wallMs: 252_000,
                },
            })
        );
        expect(dto.status).toBe("completed");
        expect(dto.caps).toContain("sample data");
        expect(dto.summary?.found).toBe(15);
        expect(dto.summary?.durationMs).toBe(252_000);
        expect(dto.summary?.sources.map(s => [s.label, s.found, s.status])).toEqual([
            ["Sample web search", 12, "ok"],
            ["Sample places", 0, "skipped"],
            ["Sample trade data", 3, "ok"],
        ]);
        expect(dto.summary?.sources[0]!.sourceId).toBe("fixture:web");
        const sources = dto.steps.find(s => s.id === "sources")!;
        expect(sources.children!.map(c => c.status)).toEqual(["done", "skipped", "done"]);
    });
});

describe("views", () => {
    const row = (over: Partial<CompanyRow>): CompanyRow => ({
        id: "r",
        name: "X",
        domain: null,
        hq: "NL",
        country: "NL",
        sizeBand: null,
        archetype: "distributor",
        why: "",
        fit: 50,
        fitThreshold: 70,
        stage: "lead",
        staleDays: null,
        people: 0,
        lastActivityAt: null,
        foundVia: [],
        isNew: false,
        excluded: false,
        excludedReason: null,
        ...over,
    });
    it("partitions rows the way the toggle group promises", () => {
        expect(viewMatches(row({}), "all")).toBe(true);
        expect(viewMatches(row({ excluded: true }), "all")).toBe(false);
        expect(viewMatches(row({ excluded: true }), "excluded")).toBe(true);
        expect(viewMatches(row({ fit: 80 }), "highfit")).toBe(true);
        expect(viewMatches(row({ stage: "contacted" }), "uncontacted")).toBe(false);
        expect(viewMatches(row({ isNew: true }), "new")).toBe(true);
    });
});
