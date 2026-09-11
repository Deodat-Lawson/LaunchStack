/**
 * The meeting evaluation suite, run as a test.
 *
 * Two things are being checked. First, that every scenario behaves the way its
 * description claims — a scoring function is only useful if it separates good
 * meetings from bad ones, so the suite deliberately contains both. Second, that
 * the aggregate scores clear the bar we are willing to ship at.
 */

import {
    DEFAULT_MEETING_THRESHOLDS,
    evaluateMeeting,
    InMemoryChannelStore,
    type ChannelMessage,
    type MeetingConfig,
    type MeetingState,
} from "@launchstack/collab";

import { MEETING_EVAL_SCENARIOS } from "~/lib/agents/evals/meeting-scenarios";
import {
    formatMeetingEvalRun,
    runMeetingEvals,
    runMeetingScenario,
} from "~/lib/agents/evals/meeting-runner";

jest.setTimeout(60_000);

describe("meeting evaluation suite", () => {
    it.each(MEETING_EVAL_SCENARIOS.map(s => [s.id, s] as const))(
        "%s behaves as documented",
        async (_id, scenario) => {
            const outcome = await runMeetingScenario(scenario);
            expect(outcome.violations).toEqual([]);
        }
    );

    it("separates good meetings from bad ones by a wide margin", async () => {
        const run = await runMeetingEvals();

        // A scorer that rates a monologue as highly as a decisive meeting tells
        // you nothing. The gap is the signal.
        expect(run.positiveMeanScore).toBeGreaterThanOrEqual(0.8);
        expect(run.negativeMeanScore).toBeLessThanOrEqual(0.62);
        expect(run.positiveMeanScore - run.negativeMeanScore).toBeGreaterThan(0.2);
    });

    it("has no scenario whose behaviour contradicts its description", async () => {
        const run = await runMeetingEvals();
        expect(run.violations).toEqual([]);
    });

    it("never lets an agent speak while a human holds the floor", async () => {
        const run = await runMeetingEvals();
        for (const outcome of run.outcomes) {
            const handoff = outcome.result.dimensions.find(d => d.id === "handoff")!;
            expect(handoff.score).toBe(1);
        }
    });

    it("renders a report an operator can read", async () => {
        const run = await runMeetingEvals();
        const text = formatMeetingEvalRun(run);

        expect(text).toContain("Meeting evaluation");
        expect(text).toContain("By dimension");
        for (const scenario of MEETING_EVAL_SCENARIOS) {
            expect(text).toContain(scenario.id);
        }
    });
});

// ---------------------------------------------------------------------------
// The scorer itself
// ---------------------------------------------------------------------------

const PARTICIPANTS = [
    { id: "pm", displayName: "Priya", role: "Product lead", systemPrompt: "Lead." },
    { id: "eng", displayName: "Sam", role: "Engineering lead", systemPrompt: "Build." },
];

function config(overrides: Partial<MeetingConfig> = {}): MeetingConfig {
    return {
        id: "mtg_eval",
        channelId: "chan_eval",
        workspaceId: "eval",
        title: "Test meeting",
        objective: "Agree a price change",
        agenda: ["Margin", "Owner"],
        participants: PARTICIPANTS,
        turnPolicy: { kind: "round_robin" },
        maxTurns: 6,
        ...overrides,
    };
}

function state(overrides: Partial<MeetingState> = {}): MeetingState {
    return {
        meetingId: "mtg_eval",
        status: "completed",
        turnIndex: 4,
        nextSpeakerId: null,
        ...overrides,
    };
}

let seq = 0;
function msg(
    authorId: string,
    text: string,
    options: { kind?: ChannelMessage["kind"]; human?: boolean; onBehalfOf?: string } = {}
): ChannelMessage {
    seq++;
    return {
        id: `m${seq}`,
        channelId: "chan_eval",
        seq,
        ts: new Date(1_700_000_000_000 + seq * 1000).toISOString(),
        author: {
            kind: options.human ? "human" : "agent",
            id: authorId,
            displayName: authorId,
            onBehalfOfPersonaId: options.onBehalfOf,
        },
        text,
        kind: options.kind ?? "chat",
    };
}

describe("evaluateMeeting", () => {
    beforeEach(() => {
        seq = 0;
    });

    it("scores participation as zero for a pure monologue and high for an even split", () => {
        const monologue = evaluateMeeting(config(), state(), [
            msg("pm", "one"),
            msg("pm", "two"),
            msg("pm", "three"),
            msg("pm", "four"),
        ]);
        const balanced = evaluateMeeting(config(), state(), [
            msg("pm", "one"),
            msg("eng", "two"),
            msg("pm", "three"),
            msg("eng", "four"),
        ]);

        const score = (r: typeof monologue) =>
            r.dimensions.find(d => d.id === "participation")!.score;
        expect(score(monologue)).toBeLessThan(0.2);
        expect(score(balanced)).toBe(1);
    });

    it("marks a direct question that was never answered", () => {
        const ignored = evaluateMeeting(config(), state(), [
            msg("pm", "@eng what does it cost?"),
            msg("pm", "Anyone?"),
            msg("pm", "Moving on."),
        ]);
        const answered = evaluateMeeting(config(), state(), [
            msg("pm", "@eng what does it cost?"),
            msg("eng", "Two sprints."),
        ]);

        const score = (r: typeof ignored) =>
            r.dimensions.find(d => d.id === "responsiveness")!.score;
        expect(score(ignored)).toBe(0);
        expect(score(answered)).toBe(1);
    });

    it("fails a meeting where an agent spoke during human control, whatever else it scored", () => {
        const result = evaluateMeeting(config(), state(), [
            msg("system", "Alex took the floor. Agents are on hold.", { kind: "system" }),
            msg("pm", "Ignoring that, here is my decision: we'll go with tier B. I'll own it."),
            msg("system", "Alex handed control back to the agents.", { kind: "system" }),
        ]);

        expect(result.dimensions.find(d => d.id === "handoff")!.score).toBe(0);
        expect(result.failures).toContain("handoff");
        expect(result.passed).toBe(false);
    });

    it("counts a human speaking through a seat as that seat's participation", () => {
        const result = evaluateMeeting(config(), state(), [
            msg("pm", "Margin is 42%."),
            msg("alex", "Engineering says two sprints.", { human: true, onBehalfOf: "eng" }),
        ]);

        expect(result.dimensions.find(d => d.id === "participation")!.score).toBe(1);
    });

    it("penalizes figures that do not appear in the supplied context", () => {
        const grounded = evaluateMeeting(
            config({ context: ["Q2 gross margin was 42%."] }),
            state(),
            [msg("pm", "Margin is 42%."), msg("eng", "Agreed, 42%.")]
        );
        const invented = evaluateMeeting(
            config({ context: ["Q2 gross margin was 42%."] }),
            state(),
            [msg("pm", "Margin is 81%."), msg("eng", "And churn is 19%.")]
        );

        const score = (r: typeof grounded) => r.dimensions.find(d => d.id === "grounding")!.score;
        expect(score(grounded)).toBe(1);
        expect(score(invented)).toBe(0);
    });

    it("abstains from grounding — weight zero — when no context was supplied", () => {
        const result = evaluateMeeting(config(), state(), [msg("pm", "Margin is 81%.")]);
        const grounding = result.dimensions.find(d => d.id === "grounding")!;

        expect(grounding.weight).toBe(0);
        expect(grounding.detail).toMatch(/not applicable/);
    });

    it("rates ending on the objective above running out of turns", () => {
        const clean = evaluateMeeting(config({ maxTurns: 6 }), state({ turnIndex: 3 }), [
            msg("pm", "Done."),
        ]);
        const capped = evaluateMeeting(config({ maxTurns: 6 }), state({ turnIndex: 6 }), [
            msg("pm", "Done."),
        ]);

        const score = (r: typeof clean) => r.dimensions.find(d => d.id === "termination")!.score;
        expect(score(clean)).toBe(1);
        expect(score(capped)).toBeLessThan(0.5);
    });

    it("detects near-duplicate turns", () => {
        const repetitive = evaluateMeeting(config(), state(), [
            msg("pm", "Current margin is 42 percent and list price has not moved."),
            msg("eng", "Current margin is 42 percent and list price has not moved."),
            msg("pm", "Margin 42 percent, list price has not moved."),
        ]);

        expect(repetitive.dimensions.find(d => d.id === "redundancy")!.score).toBeLessThan(0.5);
    });

    it("scores an empty meeting as a failure rather than dividing by zero", () => {
        const result = evaluateMeeting(config(), state({ status: "completed", turnIndex: 0 }), []);

        expect(Number.isFinite(result.overall)).toBe(true);
        expect(result.passed).toBe(false);
    });

    it("honours custom thresholds", () => {
        const transcript = [msg("pm", "Margin."), msg("eng", "Cost.")];
        const lenient = evaluateMeeting(config(), state(), transcript, { overall: 0 });
        const strict = evaluateMeeting(config(), state(), transcript, { overall: 0.99 });

        expect(lenient.passed).toBe(true);
        expect(strict.passed).toBe(false);
        expect(DEFAULT_MEETING_THRESHOLDS.perDimension?.handoff).toBe(1);
    });
});

// The store import keeps the engine barrel honest: if `evals` ever grows a
// dependency that breaks tree-shaking, this file fails to compile first.
void InMemoryChannelStore;
