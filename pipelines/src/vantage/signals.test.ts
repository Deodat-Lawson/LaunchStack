import { describe, expect, it } from "vitest";

import type {
    VantageCommitmentRow,
    VantageEvidenceRow,
    VantageMetricDefinitionRow,
    VantageMetricObservationRow,
} from "./schema";
import {
    buildEvidencePack,
    computeSignals,
    detectMetricChanges,
    draftFromRules,
    validateFacts,
} from "./signals";

const COMPANY = 1n;
const NOW = new Date(2026, 9, 2, 10, 0, 0); // Friday 2 Oct 2026
const WEEK = "2026-10-05";

function def(id: string, key: string, name = key): VantageMetricDefinitionRow {
    return {
        id,
        companyId: COMPANY,
        key,
        name,
        definition: `${name} definition`,
        unit: "count",
        createdAt: new Date(2026, 8, 1),
        updatedAt: null,
    };
}

function obs(
    id: string,
    metricId: string,
    value: number,
    periodStart: string,
    periodEnd: string,
    source: string | null = "Mixpanel"
): VantageMetricObservationRow {
    return {
        id,
        companyId: COMPANY,
        metricId,
        createdByUserId: "u1",
        value,
        periodStart,
        periodEnd,
        source,
        note: null,
        createdAt: new Date(2026, 8, 28),
    };
}

function ev(
    id: string,
    kind: VantageEvidenceRow["kind"],
    observedAt: string,
    title = id
): VantageEvidenceRow {
    return {
        id,
        companyId: COMPANY,
        createdByUserId: "u1",
        kind,
        title,
        body: `${title} body. More text here.`,
        source: null,
        sourceUrl: null,
        observedAt,
        visibility: "private",
        tags: [],
        createdAt: new Date(2026, 8, 29),
        updatedAt: null,
    };
}

function cm(
    id: string,
    dueOn: string,
    status: VantageCommitmentRow["status"] = "open"
): VantageCommitmentRow {
    return {
        id,
        companyId: COMPANY,
        createdByUserId: "u1",
        agendaId: null,
        topicId: null,
        title: `Commitment ${id}`,
        owner: "Dana",
        dueOn,
        test: null,
        status,
        outcome: null,
        shared: false,
        resolvedAt: status === "open" ? null : new Date(2026, 8, 30),
        createdAt: new Date(2026, 8, 20),
        updatedAt: null,
    };
}

describe("metric change detection", () => {
    it("compares the latest period with the previous non-overlapping one and flags a notable swing", () => {
        const signups = def("m1", "signups", "Signups");
        const { changes } = detectMetricChanges(
            [signups],
            [
                obs("o1", "m1", 40, "2026-09-21", "2026-09-27"),
                obs("o2", "m1", 30, "2026-09-14", "2026-09-20"),
                obs("o3", "m1", 28, "2026-09-07", "2026-09-13"),
            ]
        );
        expect(changes).toHaveLength(1);
        const c = changes[0]!;
        expect(c.latest.observationId).toBe("o1");
        expect(c.previous?.observationId).toBe("o2");
        expect(c.delta).toBe(10);
        expect(c.pct).toBeCloseTo(0.333, 2);
        expect(c.direction).toBe("up");
        expect(c.notable).toBe(true);
    });

    it("treats a small move as not notable and a first number as new", () => {
        const m = def("m1", "active");
        const small = detectMetricChanges(
            [m],
            [
                obs("a", "m1", 102, "2026-09-21", "2026-09-27"),
                obs("b", "m1", 100, "2026-09-14", "2026-09-20"),
            ]
        ).changes[0]!;
        expect(small.notable).toBe(false);
        expect(small.direction).toBe("up");
        const first = detectMetricChanges([m], [obs("a", "m1", 5, "2026-09-21", "2026-09-27")])
            .changes[0]!;
        expect(first.direction).toBe("new");
        expect(first.previous).toBeNull();
    });

    it("reports two disagreeing numbers for overlapping periods as a conflict, not a change", () => {
        const users = def("m1", "users", "Users");
        const { changes, conflicts } = detectMetricChanges(
            [users],
            [
                obs("deck", "m1", 1200, "2026-09-01", "2026-09-30", "Pitch deck"),
                obs("analytics", "m1", 900, "2026-09-01", "2026-09-30", "Analytics"),
            ]
        );
        expect(conflicts).toHaveLength(1);
        expect([conflicts[0]!.a.source, conflicts[0]!.b.source].sort()).toEqual([
            "Analytics",
            "Pitch deck",
        ]);
        // The overlapping row is not used as "previous".
        expect(changes[0]!.previous).toBeNull();
    });

    it("lists metrics with no numbers instead of inventing one", () => {
        const { withoutData } = detectMetricChanges(
            [def("m1", "paying"), def("m2", "signups")],
            [obs("o", "m2", 3, "2026-09-21", "2026-09-27")]
        );
        expect(withoutData).toEqual(["paying"]);
    });
});

describe("weekly signals", () => {
    const definitions = [def("m1", "signups", "Signups")];
    const observations = [
        obs("o1", "m1", 40, "2026-09-21", "2026-09-27"),
        obs("o2", "m1", 30, "2026-09-14", "2026-09-20"),
    ];
    const evidence = [
        ev("e1", "interview", "2026-09-29", "Call with Dana"),
        ev("e2", "note", "2026-09-25"),
        ev("old", "interview", "2026-08-01", "Old call"),
    ];
    const commitments = [
        cm("c1", "2026-09-30"),
        cm("c2", "2026-10-06"),
        cm("c3", "2026-09-20", "done"),
    ];

    it("windows evidence to the last two weeks and sorts commitments into overdue, due and resolved", () => {
        const s = computeSignals({
            weekStart: WEEK,
            now: NOW,
            definitions,
            observations,
            evidence,
            commitments,
        });
        expect(s.since).toBe("2026-09-18");
        expect(s.recentEvidenceIds).toEqual(["e1", "e2"]);
        expect(s.newEvidence).toEqual(
            expect.arrayContaining([
                { kind: "interview", count: 1 },
                { kind: "note", count: 1 },
            ])
        );
        expect(s.overdueCommitmentIds).toEqual(["c1"]);
        expect(s.dueThisWeekCommitmentIds).toEqual(["c2"]);
        expect(s.resolvedCommitmentIds).toEqual(["c3"]);
        expect(s.daysSinceLastEntry).toBe(3);
    });

    it("builds a pack whose ids the generator must cite, without the stale interview", () => {
        const inputs = {
            weekStart: WEEK,
            now: NOW,
            definitions,
            observations,
            evidence,
            commitments,
        };
        const pack = buildEvidencePack(inputs, computeSignals(inputs));
        const refs = pack.items.map(i => i.ref);
        expect(refs).toContain("ev:e1");
        expect(refs).not.toContain("ev:old");
        expect(refs).toContain("obs:o1");
        expect(refs).toContain("cm:c1");
        expect(pack.items.find(i => i.ref === "obs:o1")!.text).toContain("Signups = 40");
        expect(pack.items.find(i => i.ref === "ev:e1")!.text).toContain("(private note)");
    });

    it("keeps only citations the pack can confirm and marks a fact with none as unsupported", () => {
        const inputs = {
            weekStart: WEEK,
            now: NOW,
            definitions,
            observations,
            evidence,
            commitments,
        };
        const pack = buildEvidencePack(inputs, computeSignals(inputs));
        const facts = validateFacts(pack, [
            { text: "40 signed up", refs: ["obs:o1", "obs:o1", "obs:nope"] },
            { text: "Everyone loves it", refs: ["ev:made-up"] },
            { text: "   ", refs: [] },
        ]);
        expect(facts).toHaveLength(2);
        expect(facts[0]!.refs.map(r => r.ref)).toEqual(["obs:o1"]);
        expect(facts[0]!.unsupported).toBe(false);
        expect(facts[1]!.unsupported).toBe(true);
    });

    it("drafts a rules-based agenda with a decision and a next step on every topic", () => {
        const inputs = {
            weekStart: WEEK,
            now: NOW,
            definitions,
            observations,
            evidence,
            commitments,
        };
        const pack = buildEvidencePack(inputs, computeSignals(inputs));
        const draft = draftFromRules(pack, inputs);
        expect(draft.origin).toBe("rules");
        expect(draft.topics.length).toBeGreaterThanOrEqual(3);
        expect(draft.topics.length).toBeLessThanOrEqual(5);
        for (const t of draft.topics) {
            expect(t.decisionQuestion.length).toBeGreaterThan(0);
            expect(t.proposedNextStep.length).toBeGreaterThan(0);
            expect(t.rationale.length).toBeGreaterThan(0);
            for (const f of t.facts) expect(f.refs.length).toBeGreaterThan(0);
        }
        const titles = draft.topics.map(t => t.title);
        expect(titles.some(t => t.startsWith("Signups rose"))).toBe(true);
        expect(titles.some(t => t.startsWith("Overdue:"))).toBe(true);
        expect(titles.some(t => t.includes("customer conversation"))).toBe(true);
        expect(draft.summary).toContain("Signups +33%");
    });

    it("says nothing was logged rather than inventing a summary", () => {
        const inputs = {
            weekStart: WEEK,
            now: NOW,
            definitions: [],
            observations: [],
            evidence: [],
            commitments: [],
        };
        const draft = draftFromRules(buildEvidencePack(inputs, computeSignals(inputs)), inputs);
        expect(draft.topics).toEqual([]);
        expect(draft.summary).toMatch(/Nothing new was logged/);
    });
});
