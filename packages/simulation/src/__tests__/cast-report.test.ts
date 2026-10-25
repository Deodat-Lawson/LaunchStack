import { describe, expect, it } from "vitest";

import {
    buildBriefRequest,
    parseBrief,
    stripCitations,
    TURN_SUBJECT_CHARS,
    turnSituation,
} from "../brief";
import { directionHits, ranks, spearman } from "../calibration";
import { buildCastRequest, parseCast } from "../cast";
import { buildDecisionRequest } from "../decide";
import { estimateRun, MAX_AGENTS } from "../estimate";
import { buildReportRequest, parseReport } from "../report";
import { runRound } from "../round";
import type { EvidenceItem } from "../types";
import { chattyScript, fakeModel, smallWorld } from "./helpers";

const evidence: EvidenceItem[] = [
    {
        id: "E1",
        kind: "document",
        label: "Customer interviews.pdf",
        text: "Small firms say price is the main reason they churn.",
        ref: { type: "document", id: "11" },
    },
    {
        id: "E2",
        kind: "brand_comment",
        label: "Comment on your LinkedIn post",
        text: "Love the product, hate the renewal email.",
        ref: { type: "brand_comment", id: "5" },
    },
];

describe("cast", () => {
    it("asks for grounded personas and forbids real names", () => {
        const req = buildCastRequest({
            subject: "s",
            brief: "b",
            evidence,
            count: 3,
            takenHandles: ["@ana"],
            audience: "customers",
            maxInvented: 1,
        });
        expect(req.purpose).toBe("cast");
        expect(req.system).toContain("Never use the name or handle of a real person");
        expect(req.prompt).toContain("[E2] (brand_comment) Comment on your LinkedIn post");
        expect(req.prompt).toContain("Handles already taken: @ana");
    });

    it("labels uncited personas invented, drops unknown sources, and keeps handles unique", () => {
        const taken = new Set(["@ana"]);
        const reply = {
            personas: [
                {
                    name: "Ana Ruiz",
                    handle: "@ana",
                    role: "Bookkeeper",
                    bio: "x",
                    interests: ["tax"],
                    stance: -1,
                    activity: 3,
                    influence: -1,
                    sourceIds: ["E1", "E9"],
                    invented: false,
                },
                {
                    name: "Bo Lin",
                    handle: "bo lin",
                    role: "Founder",
                    bio: "y",
                    interests: [],
                    stance: 9,
                    activity: 0.5,
                    influence: 0.5,
                    sourceIds: ["E7"],
                    invented: false,
                },
                {
                    name: "Cy",
                    handle: "@cy",
                    role: "",
                    bio: "",
                    interests: [],
                    stance: 0,
                    activity: 0.5,
                    influence: 0.5,
                    sourceIds: [],
                    invented: true,
                },
                {
                    name: "Di",
                    handle: "@di",
                    role: "Analyst",
                    bio: "",
                    interests: [],
                    stance: 0,
                    activity: 0.5,
                    influence: 0.5,
                    sourceIds: ["E2"],
                    invented: true,
                },
            ],
        };
        const out = parseCast(JSON.stringify(reply), {
            evidenceIds: new Set(["E1", "E2"]),
            startIndex: 4,
            takenHandles: taken,
            limit: 10,
        });
        expect(out.map(p => [p.id, p.handle, p.grounding, p.sourceIds])).toEqual([
            ["a4", "@ana2", "grounded", ["E1"]],
            ["a5", "@bo_lin", "invented", []],
            ["a6", "@di", "invented", []],
        ]);
        expect(out[0]).toMatchObject({ activity: 1, influence: 0, stance: -1 });
        expect(out[1]!.stance).toBe(2);
        expect(taken.has("@bo_lin")).toBe(true);
    });
});

describe("brief", () => {
    it("keeps only citations to evidence that exists", () => {
        const parsed = parseBrief(
            JSON.stringify({
                brief: "Churn is about price [E1]. Renewals annoy people [E2][E5].",
                openingPost: "Acme raised prices [E1].",
                evidenceIds: ["E2", "E8"],
            }),
            new Set(["E1", "E2"])
        )!;
        expect(parsed.brief).toBe("Churn is about price [E1]. Renewals annoy people [E2].");
        expect(parsed.openingPost).toBe("Acme raised prices.");
        expect(parsed.evidenceIds.sort()).toEqual(["E1", "E2"]);
        expect(stripCitations(parsed.brief)).toBe("Churn is about price. Renewals annoy people.");
        expect(buildBriefRequest({ subject: "s", evidence, mode: "post_test" }).system).toContain(
            'openingPost: ""'
        );
    });
});

describe("a long situation", () => {
    const plan = [
        "We launch the Pro plan at $49 a month in March.",
        `The plan: ${"bundle onboarding with priority support for small firms, ".repeat(15)}`,
        "Current cases: three pilots renewed; one churned over price.",
    ].join("\n\n");

    it("is read in full by the brief, which restates it for the turns", () => {
        expect(plan.length).toBeGreaterThan(TURN_SUBJECT_CHARS);
        const req = buildBriefRequest({ subject: plan, evidence, mode: "scenario" });
        expect(req.prompt).toContain(plan);
        expect(req.system).toContain("situation: the subject restated");
        expect(
            buildBriefRequest({ subject: "We raise prices.", evidence, mode: "scenario" }).system
        ).toContain('situation: "".');

        const parsed = parseBrief(
            JSON.stringify({
                brief: "Small firms churn on price [E1].",
                openingPost: "Acme launches Pro at $49.",
                situation: "Acme launches Pro at $49 in March, bundling onboarding [E1].",
                evidenceIds: ["E1"],
            }),
            new Set(["E1"])
        )!;
        expect(parsed.situation).toBe("Acme launches Pro at $49 in March, bundling onboarding.");
        expect(turnSituation(plan, parsed)).toBe(parsed.situation);
        expect(turnSituation("We raise prices.", parsed)).toBeUndefined();
        // Without a restatement, turns get the start of the subject.
        expect(turnSituation(plan, null)!.length).toBe(TURN_SUBJECT_CHARS);
        expect(
            parseBrief(
                JSON.stringify({ brief: "b", openingPost: "", situation: "", evidenceIds: [] }),
                new Set()
            )
        ).not.toHaveProperty("situation");
    });

    it("goes to people's turns as the restatement, not the whole plan", () => {
        const world = smallWorld();
        world.subject = plan;
        world.situation = "Acme launches Pro at $49 in March.";
        const req = buildDecisionRequest(world, world.agents[0]!, []);
        expect(req.system).toContain("Subject everyone is reacting to: Acme launches Pro");
        expect(req.system).not.toContain("Current cases");
        expect(buildDecisionRequest(smallWorld(), smallWorld().agents[0]!, []).system).toContain(
            "Subject everyone is reacting to: Acme raises prices by 20%"
        );
    });
});

describe("report", () => {
    it("keeps cited posts that exist and computes faction shares from the world", async () => {
        const { world } = await runRound(smallWorld(), { model: fakeModel(chattyScript) });
        const req = buildReportRequest(world, { targetPostId: "p1" });
        expect(req.prompt).toContain("Post under test: p1: seen by 4, engaged 4 (100%)");
        expect(req.system).toContain("This is a scenario, not a forecast");
        const report = parseReport(
            JSON.stringify({
                headline: "Supporters outnumber critics.",
                summary: "Three of four warmed to it.",
                dynamics: [{ text: "Early comments set the tone.", postIds: ["p1", "p999"] }],
                turningPoints: [{ round: 7, text: "x", postIds: [] }],
                factions: [{ stance: "critical", label: "Price hawks", text: "Cost." }],
                watchFor: ["Support tickets mentioning price"],
            }),
            world
        )!;
        expect(report.dynamics[0]!.postIds).toEqual(["p1"]);
        expect(report.turningPoints[0]!.round).toBe(1);
        expect(report.factions.map(f => [f.stance, f.share])).toEqual([
            ["critical", 0.25],
            ["supportive", 0.75],
        ]);
        expect(parseReport("{}", world)).toBeUndefined();
    });
});

describe("estimate", () => {
    it("grows with size and clamps to the caps", () => {
        const small = estimateRun({ agents: 10, rounds: 3 });
        const big = estimateRun({ agents: 30, rounds: 8 });
        expect(big.calls).toBeGreaterThan(small.calls);
        expect(big.inputTokens).toBeGreaterThan(small.inputTokens);
        expect(estimateRun({ agents: 10_000, rounds: 3 })).toEqual(
            estimateRun({ agents: MAX_AGENTS, rounds: 3 })
        );
    });
});

describe("calibration", () => {
    it("computes Spearman with tied ranks", () => {
        expect(ranks([10, 20, 20, 5])).toEqual([2, 3.5, 3.5, 1]);
        expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBe(1);
        expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBe(-1);
        expect(spearman([1, 2], [1, 2])).toBeUndefined();
        expect(spearman([1, 1, 1], [1, 2, 3])).toBeUndefined();
    });

    it("counts posts the simulation put on the right side of the median", () => {
        expect(directionHits([0.1, 0.5, 0.9, 0.2], [1, 5, 9, 8])).toEqual({ hits: 2, total: 4 });
        expect(directionHits([], [])).toEqual({ hits: 0, total: 0 });
    });
});

describe("cleanProse", () => {
    it("turns TeX arrows and symbols some models write into plain characters", async () => {
        const { cleanProse } = await import("../text");
        expect(cleanProse("Free $\\rightarrow$ Trial $\\rightarrow$ Read-only")).toBe(
            "Free → Trial → Read-only"
        );
        expect(cleanProse("costs $\\geq$ 20% and $\\times$ 2 .")).toBe("costs ≥ 20% and × 2.");
        expect(cleanProse("A $5 plan and a $10 plan")).toBe("A $5 plan and a $10 plan");
        // The same TeX after a JSON decoder turned \r and \t into control characters.
        expect(cleanProse(JSON.parse('"Free $\\rightarrow$ Trial, x $\\times$ 2"'))).toBe(
            "Free → Trial, x × 2"
        );
    });
});

describe("cleanAnswer", () => {
    it("reads a JSON answer or plain text", async () => {
        const { cleanAnswer } = await import("../interview");
        expect(cleanAnswer('{"answer": "Because of margins."}')).toBe("Because of margins.");
        expect(cleanAnswer("A: Because of margins.")).toBe("Because of margins.");
    });
});
