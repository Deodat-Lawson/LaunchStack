/**
 * Meeting evaluation scenarios.
 *
 * Each scenario is a complete meeting specification plus the scripted turns
 * that will be produced. Scripting the turns is the point: it makes the
 * *orchestration* — turn order, human handoff, termination, minutes — the thing
 * under test, and keeps the suite deterministic and free. The scenarios include
 * deliberately bad meetings, because a scoring function that only ever sees
 * good input is not a scoring function.
 */

import type { AgentPersona, TurnPolicy } from "@launchstack/core/collab";

export interface MeetingEvalScenario {
    id: string;
    name: string;
    description: string;
    title: string;
    objective: string;
    agenda: string[];
    participants: AgentPersona[];
    turnPolicy?: TurnPolicy;
    maxTurns: number;
    context?: string[];
    /** Persona id → the lines it will say, in order. */
    script: Record<string, string[]>;
    /**
     * A human interjection injected before the given turn index. Exercises the
     * takeover path inside the eval, not just in unit tests.
     */
    humanTakeover?: {
        beforeTurn: number;
        displayName: string;
        text: string;
        asPersonaId?: string;
    };
    /** What this scenario is supposed to demonstrate. */
    expect: {
        /** Overall score this scenario must clear. */
        minScore?: number;
        /** Overall score this scenario must stay under (for negative cases). */
        maxScore?: number;
        /** Dimensions expected to score at or above the given value. */
        minDimension?: Record<string, number>;
        /** Dimensions expected to score at or below the given value. */
        maxDimension?: Record<string, number>;
        shouldPass: boolean;
    };
}

const PM: AgentPersona = {
    id: "pm",
    displayName: "Priya",
    role: "Product lead",
    systemPrompt: "Drive the agenda and force a decision.",
};
const ENG: AgentPersona = {
    id: "eng",
    displayName: "Sam",
    role: "Engineering lead",
    systemPrompt: "Judge feasibility and cost of delivery.",
};
const FIN: AgentPersona = {
    id: "fin",
    displayName: "Dana",
    role: "Finance partner",
    systemPrompt: "Guard the margin.",
};

const PRICING_CONTEXT = [
    "Q2 gross margin was 42%. List price has been unchanged for four quarters.",
    "Billing migration to usage-based metering is estimated at two sprints.",
    "Tier B modelling shows margin recovering to 44% within one quarter.",
];

export const MEETING_EVAL_SCENARIOS: MeetingEvalScenario[] = [
    {
        id: "pricing-decisive",
        name: "Decisive pricing review",
        description:
            "The reference case: agenda worked through, every voice heard, a decision made and owned, ended on the objective rather than the turn cap.",
        title: "Q3 pricing review",
        objective: "Agree a Q3 price change and name who ships it",
        agenda: ["Current margin", "Proposed tier change", "Owner and timing"],
        participants: [PM, ENG, FIN],
        maxTurns: 9,
        context: PRICING_CONTEXT,
        script: {
            pm: [
                "Current margin is 42% and list price has not moved in four quarters. @eng what does a tier change cost us to build?",
                "Decision: we'll go with tier B. @eng owns the rollout, @fin confirms the margin model.",
            ],
            eng: [
                "The proposed tier change needs usage-based metering. That is two sprints, and the billing migration is the long pole. I'll own the migration.",
                "Rollout and timing are mine. Nothing else blocks us.",
            ],
            fin: [
                "Tier B recovers margin to 44% within a quarter, so the owner question is the only open one.",
                "Margin model confirmed. MEETING_COMPLETE",
            ],
        },
        expect: {
            shouldPass: true,
            minScore: 0.8,
            minDimension: {
                coverage: 0.6,
                participation: 0.8,
                decisions: 1,
                termination: 1,
                handoff: 1,
            },
        },
    },

    {
        id: "pricing-human-takeover",
        name: "Human takes the floor mid-meeting",
        description:
            "A person interrupts, redirects the meeting, and hands control back. Agent turns must stop while they hold the floor.",
        title: "Q3 pricing review",
        objective: "Agree a Q3 price change and name who ships it",
        agenda: ["Current margin", "Proposed tier change", "Owner and timing"],
        participants: [PM, ENG, FIN],
        maxTurns: 9,
        context: PRICING_CONTEXT,
        humanTakeover: {
            beforeTurn: 2,
            displayName: "Alex Chen",
            text: "Stop — legal flagged the tier names. Assume we ship tier B under the existing naming.",
        },
        script: {
            pm: [
                "Current margin is 42%. @eng what does the proposed tier change cost to build?",
                "Understood on naming. Decision: we'll go with tier B under existing names. @eng owns the rollout.",
            ],
            eng: [
                "Two sprints; the billing migration is the long pole. I'll own the migration.",
                "Rollout is mine, timing unchanged.",
            ],
            fin: [
                "Margin recovers to 44% within a quarter, so owner and timing is the only open item.",
                "Confirmed. MEETING_COMPLETE",
            ],
        },
        expect: {
            shouldPass: true,
            minScore: 0.75,
            minDimension: { handoff: 1, decisions: 1 },
        },
    },

    {
        id: "circular-no-decision",
        name: "Busy transcript, nothing decided",
        description:
            "Negative case. Everyone takes a turn and the agenda words all appear, but the meeting restates the same fact, decides nothing, and runs to the turn cap.",
        title: "Q3 pricing review",
        objective: "Agree a Q3 price change and name who ships it",
        agenda: ["Current margin", "Proposed tier change", "Owner and timing"],
        participants: [PM, ENG, FIN],
        turnPolicy: { kind: "reactive" },
        maxTurns: 6,
        context: PRICING_CONTEXT,
        script: {
            // Nobody is addressed and no role words match, so the reactive policy
            // falls back to rotation. Airtime looks healthy; content does not.
            pm: [
                "Current margin is 42% and list price has not moved.",
                "Margin is 42%, list price has not moved.",
                "Again: margin 42%, list price flat.",
            ],
            eng: ["Noted.", "Noted."],
            fin: ["Noted."],
        },
        expect: {
            shouldPass: false,
            maxScore: 0.65,
            maxDimension: { decisions: 0.3, termination: 0.5 },
        },
    },

    {
        id: "dropped-question",
        name: "Direct question ignored",
        description:
            "Negative case. Someone is asked a specific question by name and never answers it, and the meeting runs to the turn cap without deciding anything.",
        title: "Renewal risk review",
        objective: "Decide whether to escalate the renewal risk on the top ten accounts",
        agenda: ["Which accounts are at risk", "What the escalation costs", "Decision"],
        participants: [PM, ENG, FIN],
        maxTurns: 4,
        script: {
            pm: [
                "@fin how many of the top ten accounts are at risk this quarter?",
                "Still waiting on the account numbers.",
            ],
            eng: ["Nothing from my side blocks an escalation.", "Same as before."],
            fin: ["I'd rather discuss the roadmap.", "The roadmap matters more."],
        },
        expect: {
            shouldPass: false,
            maxScore: 0.6,
            maxDimension: { responsiveness: 0.4, decisions: 0.3 },
        },
    },

    {
        id: "ungrounded-figures",
        name: "Invented figures",
        description:
            "Negative case. The agents cite precise numbers that appear nowhere in the supplied context — the failure mode that makes minutes dangerous.",
        title: "Q3 pricing review",
        objective: "Agree a Q3 price change and name who ships it",
        agenda: ["Current margin", "Proposed tier change"],
        participants: [PM, FIN],
        maxTurns: 4,
        context: PRICING_CONTEXT,
        script: {
            pm: [
                "Margin is 81% and churn is running at 19%. @fin does tier B hold?",
                "Decision: we'll go with tier B at the 73% target.",
            ],
            fin: [
                "Tier B lands us at 67% margin against the 91% ceiling.",
                "Confirmed at 67%. MEETING_COMPLETE",
            ],
        },
        expect: {
            shouldPass: false,
            maxDimension: { grounding: 0.35 },
        },
    },

    {
        id: "moderated-incident",
        name: "Moderated incident review",
        description:
            "A chair directs the floor by name. Tests that the moderated policy still produces even participation and a clean close.",
        title: "Checkout incident review",
        objective: "Decide whether to roll back the checkout release and name an owner",
        agenda: ["What broke", "Blast radius", "Roll back or fix forward"],
        participants: [PM, ENG, FIN],
        turnPolicy: { kind: "moderated", moderatorId: "pm" },
        maxTurns: 8,
        context: [
            "Checkout error rate rose from 0.2% to 3% after the release at 14:10.",
            "The previous build is still deployable; rollback takes about 12 minutes.",
        ],
        script: {
            pm: [
                "Checkout error rate went from 0.2% to 3% after the 14:10 release. @eng what broke?",
                "Thanks. @fin what is the blast radius in revenue terms?",
                "Decision: we'll go with the rollback. @eng owns it. MEETING_COMPLETE",
            ],
            eng: [
                "A null address field in the new payment path. The previous build is deployable and rollback takes about 12 minutes. I'll own the rollback.",
                "Rollback is mine, twelve minutes.",
            ],
            fin: ["At 3% error we're losing roughly a percent of daily checkout revenue per hour."],
        },
        expect: {
            shouldPass: true,
            minScore: 0.75,
            minDimension: { decisions: 1, termination: 1, responsiveness: 0.9 },
        },
    },
];
