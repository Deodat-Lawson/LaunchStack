/**
 * Meeting workflows — the templates a meeting starts from.
 *
 * A workflow is a recipe: what the meeting is for, the agenda it works, which
 * agents belong in the room, how the floor moves, and the *phases* the
 * conversation goes through. Phases are what make a meeting more than a
 * round of opinions: diverge before you critique, critique before you decide.
 * They are enforced by the engine (`@launchstack/collab` `phases.ts`), so a
 * workflow is a promise about the shape of the transcript, not a suggestion.
 *
 * Pure data with one helper. The dialog reads it to prefill; the API accepts
 * the resulting plan; nothing here touches the network.
 */

import type { MeetingPhase, TurnPolicyKind } from "@launchstack/collab";

export interface WorkflowPhaseTemplate {
    id: string;
    title: string;
    goal: string;
    turns: number;
    /** Agent handles that speak in this phase. Empty = everyone in the room. */
    speakers?: string[];
}

export interface MeetingWorkflow {
    key: string;
    title: string;
    /** One line for the card. */
    tagline: string;
    /** Two or three sentences on when to reach for it. */
    description: string;
    /** Suggested objective; the person edits it before starting. */
    objectiveTemplate: string;
    agenda: string[];
    /** Handles of the agents that belong in the room, in seating order. */
    agents: string[];
    turnPolicy: TurnPolicyKind;
    /** Which agent chairs, under `moderated`. */
    moderator?: string;
    phases: WorkflowPhaseTemplate[];
    /** For grouping on the dashboard. */
    category: "decide" | "review" | "explore" | "run";
}

export const MEETING_WORKFLOWS: readonly MeetingWorkflow[] = [
    {
        key: "decision-review",
        title: "Decision review",
        tagline: "Frame it, analyse it, attack it, decide it.",
        description:
            "For a choice that needs more than one perspective. The chair frames the question, the specialists build the case, the devil's advocate tries to break it, and the chair lands a decision with an owner.",
        objectiveTemplate: "Decide whether to <change>, and name who owns it",
        agenda: [
            "What we are deciding and why now",
            "The case for and against",
            "Risks and unknowns",
            "Decision, owner, timing",
        ],
        agents: ["facilitator", "analyst", "finance", "engineer", "critic"],
        turnPolicy: "moderated",
        moderator: "facilitator",
        category: "decide",
        phases: [
            {
                id: "frame",
                title: "Frame",
                goal: "State the decision, the options on the table and what a good outcome looks like.",
                turns: 1,
                speakers: ["facilitator"],
            },
            {
                id: "analyse",
                title: "Analyse",
                goal: "Build the case from the sources: numbers, feasibility, cost. No verdicts yet.",
                turns: 4,
                speakers: ["facilitator", "analyst", "finance", "engineer"],
            },
            {
                id: "challenge",
                title: "Challenge",
                goal: "Attack the strongest option. Name the assumption it rests on and how it fails.",
                turns: 2,
                speakers: ["facilitator", "critic"],
            },
            {
                id: "decide",
                title: "Decide",
                goal: "Answer the challenge, then decide: one option, one owner, one date.",
                turns: 3,
                speakers: ["facilitator", "analyst", "finance", "engineer", "critic"],
            },
        ],
    },
    {
        key: "premortem",
        title: "Pre-mortem",
        tagline: "It is a year later and the plan failed. Why?",
        description:
            "Run before committing to a plan. Everyone imagines the failure first, then the room ranks the causes and assigns a mitigation to each one that matters.",
        objectiveTemplate:
            "Find the ways <plan> fails and assign a mitigation to each one that matters",
        agenda: [
            "The plan as it stands",
            "How it failed",
            "Which causes matter",
            "Mitigations and owners",
        ],
        agents: ["facilitator", "engineer", "finance", "sales", "critic"],
        turnPolicy: "moderated",
        moderator: "facilitator",
        category: "review",
        phases: [
            {
                id: "imagine",
                title: "Imagine the failure",
                goal: "It is twelve months on and the plan failed. Each of you: say how, from your seat.",
                turns: 5,
            },
            {
                id: "rank",
                title: "Rank the causes",
                goal: "Which failures are likely and costly? Agree the top three.",
                turns: 3,
                speakers: ["facilitator", "critic", "finance"],
            },
            {
                id: "mitigate",
                title: "Mitigate",
                goal: "One mitigation per top cause, with an owner and a trigger that says it is happening.",
                turns: 3,
            },
        ],
    },
    {
        key: "contract-review",
        title: "Contract review",
        tagline: "Exposure, obligations, money — then a recommendation.",
        description:
            "Point it at an agreement in the workspace. Compliance reads for exposure, the analyst extracts the terms, finance prices them, and the chair writes the recommendation.",
        objectiveTemplate:
            "Review <agreement> and recommend sign, negotiate, or walk — with the clauses to change",
        agenda: [
            "Key terms and obligations",
            "Risks and missing pieces",
            "Commercial impact",
            "Recommendation",
        ],
        agents: ["facilitator", "counsel", "analyst", "finance"],
        turnPolicy: "moderated",
        moderator: "facilitator",
        category: "review",
        phases: [
            {
                id: "terms",
                title: "Extract the terms",
                goal: "List the obligations, dates, amounts and termination terms, with clause references.",
                turns: 2,
                speakers: ["facilitator", "analyst"],
            },
            {
                id: "risk",
                title: "Read for risk",
                goal: "Which clauses create exposure, what is missing, and what would need to change.",
                turns: 2,
                speakers: ["facilitator", "counsel"],
            },
            {
                id: "money",
                title: "Price it",
                goal: "What the terms cost or earn over the life of the agreement, and the downside case.",
                turns: 2,
                speakers: ["facilitator", "finance"],
            },
            {
                id: "recommend",
                title: "Recommend",
                goal: "Sign, negotiate or walk. Name the clauses to change and who takes the conversation.",
                turns: 2,
            },
        ],
    },
    {
        key: "pricing-review",
        title: "Pricing review",
        tagline: "Margin meets the pipeline.",
        description:
            "For a price or packaging change. Finance brings the margin model, sales brings the objections, product brings the packaging, and the room agrees a change and who ships it.",
        objectiveTemplate: "Agree a <quarter> price change and name who ships it",
        agenda: [
            "Current margin and price history",
            "Proposed change",
            "What buyers will say",
            "Owner and timing",
        ],
        agents: ["facilitator", "finance", "sales", "product", "engineer"],
        turnPolicy: "moderated",
        moderator: "facilitator",
        category: "decide",
        phases: [
            {
                id: "numbers",
                title: "The numbers",
                goal: "Current margin, price history and what the proposed change does to both.",
                turns: 2,
                speakers: ["facilitator", "finance"],
            },
            {
                id: "market",
                title: "The market",
                goal: "What buyers asked for, which objections the change triggers, and what it does to open deals.",
                turns: 3,
                speakers: ["facilitator", "sales", "product"],
            },
            {
                id: "deliver",
                title: "Delivery",
                goal: "What changing the price or packaging costs to build and ship.",
                turns: 1,
                speakers: ["facilitator", "engineer"],
            },
            { id: "decide", title: "Decide", goal: "One change, one owner, one date.", turns: 3 },
        ],
    },
    {
        key: "brainstorm",
        title: "Brainstorm → critique → converge",
        tagline: "Many ideas, then fewer, then one.",
        description:
            "For an open question. Everyone diverges first with no critique allowed, the product lead clusters, the devil's advocate thins the field, and the room converges on one thing to try.",
        objectiveTemplate: "Generate options for <question> and pick one to try next",
        agenda: ["Ideas, uncritically", "Clusters", "What survives critique", "The one to try"],
        agents: ["facilitator", "product", "marketing", "engineer", "support", "critic"],
        turnPolicy: "round_robin",
        category: "explore",
        phases: [
            {
                id: "diverge",
                title: "Diverge",
                goal: "Ideas only. Build on others; do not evaluate. Two or three each, one line apiece.",
                turns: 6,
                speakers: ["facilitator", "product", "marketing", "engineer", "support"],
            },
            {
                id: "cluster",
                title: "Cluster",
                goal: "Group the ideas into three or four themes and name the strongest in each.",
                turns: 1,
                speakers: ["product"],
            },
            {
                id: "critique",
                title: "Critique",
                goal: "Thin the field: which themes fail on cost, feasibility or the customer, and why.",
                turns: 2,
                speakers: ["critic", "engineer"],
            },
            {
                id: "converge",
                title: "Converge",
                goal: "Pick one idea to try, define the smallest test, and name who runs it.",
                turns: 3,
                speakers: ["facilitator", "product", "critic"],
            },
        ],
    },
    {
        key: "launch-readiness",
        title: "Launch readiness",
        tagline: "Go, no-go, or go-with-conditions.",
        description:
            "Before a release goes out. Each function reports readiness from its seat, the customer voice checks the day-one experience, and the chair calls it.",
        objectiveTemplate: "Decide go / no-go for <launch> and list the conditions",
        agenda: [
            "Readiness by function",
            "Day-one customer experience",
            "Open risks",
            "Go / no-go",
        ],
        agents: ["facilitator", "product", "engineer", "marketing", "support"],
        turnPolicy: "moderated",
        moderator: "facilitator",
        category: "decide",
        phases: [
            {
                id: "status",
                title: "Readiness",
                goal: "Each function: ready, not ready, or ready-with-conditions — and the evidence.",
                turns: 4,
                speakers: ["product", "engineer", "marketing", "support"],
            },
            {
                id: "risk",
                title: "Open risks",
                goal: "The risks that could still stop the launch, ranked, with who can retire each one.",
                turns: 2,
            },
            {
                id: "call",
                title: "The call",
                goal: "Go, no-go or go-with-conditions. List the conditions with owners and dates.",
                turns: 2,
                speakers: ["facilitator", "product"],
            },
        ],
    },
    {
        key: "feedback-triage",
        title: "Customer feedback triage",
        tagline: "From what they said to what we do.",
        description:
            "Point it at interviews, tickets or reviews. The customer voice reports the themes with counts, product and engineering size the responses, and the room agrees what to do first.",
        objectiveTemplate:
            "Turn the feedback in <sources> into a ranked list of things to fix or build",
        agenda: [
            "What customers said, with counts",
            "Root causes",
            "Options and cost",
            "What we do first",
        ],
        agents: ["support", "product", "engineer", "analyst"],
        turnPolicy: "reactive",
        category: "review",
        phases: [
            {
                id: "themes",
                title: "Themes",
                goal: "The recurring complaints and requests, in the customers' words, with how often each came up.",
                turns: 2,
                speakers: ["support", "analyst"],
            },
            {
                id: "causes",
                title: "Root causes",
                goal: "For the top themes: what in the product causes them.",
                turns: 2,
                speakers: ["engineer", "product"],
            },
            {
                id: "options",
                title: "Options",
                goal: "Fixes and their cost; which are quick and which are a project.",
                turns: 2,
            },
            {
                id: "rank",
                title: "Rank",
                goal: "Order by customer impact over cost. First three, with owners.",
                turns: 2,
                speakers: ["product", "support"],
            },
        ],
    },
    {
        key: "weekly-sync",
        title: "Weekly sync",
        tagline: "Updates, blockers, next steps — in ten turns.",
        description:
            "A short standing meeting over the week's sources. Each seat reports what changed and what is blocked; the chair collects the next steps.",
        objectiveTemplate: "Review the week and agree next steps for <team>",
        agenda: ["What changed", "What is blocked", "Next steps"],
        agents: ["facilitator", "product", "engineer", "sales", "finance"],
        turnPolicy: "round_robin",
        category: "run",
        phases: [
            {
                id: "updates",
                title: "Updates",
                goal: "One update each: what changed since last time, from the sources where possible.",
                turns: 5,
            },
            {
                id: "blockers",
                title: "Blockers",
                goal: "What is blocked, who can unblock it.",
                turns: 3,
                speakers: ["product", "engineer", "sales"],
            },
            {
                id: "next",
                title: "Next steps",
                goal: "Collect the next steps with owners; close.",
                turns: 2,
                speakers: ["facilitator", "finance"],
            },
        ],
    },
    {
        key: "open-discussion",
        title: "Open discussion",
        tagline: "No phases — just the objective and the room.",
        description:
            "Pick the agents, state the objective, and let the turn policy run. The right choice when the question does not fit a recipe.",
        objectiveTemplate: "",
        agenda: [],
        agents: ["facilitator", "analyst", "critic"],
        turnPolicy: "round_robin",
        category: "explore",
        phases: [],
    },
];

export const WORKFLOW_CATEGORY_META: Record<MeetingWorkflow["category"], { label: string }> = {
    decide: { label: "Decide something" },
    review: { label: "Review something" },
    explore: { label: "Explore a question" },
    run: { label: "Run a routine" },
};

export function meetingWorkflow(key: string | null | undefined): MeetingWorkflow | undefined {
    if (!key) return undefined;
    return MEETING_WORKFLOWS.find(workflow => workflow.key === key);
}

/** Turns the total the phases add up to — the natural turn limit. */
export function workflowTurnCount(workflow: Pick<MeetingWorkflow, "phases">): number {
    return workflow.phases.reduce((sum, phase) => sum + phase.turns, 0);
}

/**
 * The phase plan for a room. Speakers not in the room are dropped; a phase
 * left with no speakers opens to everyone rather than stalling.
 */
export function phasesForRoom(
    workflow: Pick<MeetingWorkflow, "phases">,
    participantKeys: readonly string[]
): MeetingPhase[] {
    const room = new Set(participantKeys);
    return workflow.phases.map(phase => {
        const speakers = (phase.speakers ?? []).filter(key => room.has(key));
        return {
            id: phase.id,
            title: phase.title,
            goal: phase.goal,
            turns: phase.turns,
            ...(speakers.length > 0 ? { speakerIds: speakers } : {}),
        };
    });
}
