/**
 * Meeting workflows — the templates a meeting starts from.
 *
 * A workflow is a recipe: what the meeting is for, the agenda it works, which
 * agents belong in the room, how the floor moves, and the *phases* the
 * conversation goes through. Phases are what make a meeting more than a
 * round of opinions: they are enforced by the engine (`@launchstack/collab`
 * `phases.ts`), so a workflow is a promise about the shape of the transcript.
 *
 * Every recipe here is a method that teams already run — in facilitation
 * playbooks, in the tools founders use, and in several cases with research
 * behind it. The `basis` on each names where it comes from; the dashboard
 * shows it. There is deliberately no workflow builder: a small set of proven
 * recipes, editable before you start, beats a blank canvas.
 *
 * Pure data with three helpers. The dialog reads it to prefill; the API
 * accepts the resulting plan; nothing here touches the network.
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

export interface WorkflowBasis {
    /** The method's name as people know it. */
    name: string;
    /** Who defined it and, where it applies, the evidence behind it. */
    origin: string;
    /** Where it is run today. */
    usedBy: string;
    url?: string;
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
    basis?: WorkflowBasis;
}

export const MEETING_WORKFLOWS: readonly MeetingWorkflow[] = [
    // ------------------------------------------------------------------
    // Decide something
    // ------------------------------------------------------------------
    {
        key: "daci-decision",
        title: "DACI decision",
        tagline: "One driver, clear contributors, a recommendation you approve.",
        description:
            "For a decision that needs several perspectives and a clear owner. The chair drives: frames the decision and the options, collects each contributor's input, has the devil's advocate test the leading option, and ends with a recommendation. You are the approver — the meeting produces the recommendation, you make the call.",
        objectiveTemplate: "Decide whether to <change>, and name who owns the outcome",
        agenda: [
            "The decision, the options, the deadline",
            "Contributor input, one seat at a time",
            "Challenge to the leading option",
            "Recommendation for the approver",
        ],
        agents: ["facilitator", "analyst", "finance", "engineer", "critic"],
        turnPolicy: "moderated",
        moderator: "facilitator",
        category: "decide",
        basis: {
            name: "DACI",
            origin: "Atlassian Team Playbook — Driver, Approver, Contributors, Informed; the driver corrals input and gets a decision made by the agreed date.",
            usedBy: "Atlassian, Confluence's decision template, and most product organisations' decision logs.",
            url: "https://www.atlassian.com/team-playbook/plays/daci",
        },
        phases: [
            {
                id: "frame",
                title: "Frame",
                goal: "State the decision, the options on the table, the deadline, and what a good outcome looks like. Name who approves.",
                turns: 1,
                speakers: ["facilitator"],
            },
            {
                id: "contribute",
                title: "Contribute",
                goal: "Each contributor gives their seat's input on the options: the numbers, the feasibility, the cost. Facts and estimates, no verdicts yet.",
                turns: 4,
                speakers: ["facilitator", "analyst", "finance", "engineer"],
            },
            {
                id: "challenge",
                title: "Challenge",
                goal: "Test the leading option: the assumption it rests on, how it fails, what would have to be true.",
                turns: 2,
                speakers: ["facilitator", "critic"],
            },
            {
                id: "recommend",
                title: "Recommend",
                goal: "Answer the challenge, then write the recommendation for the approver: one option, why, the owner, the date, what is deferred.",
                turns: 3,
            },
        ],
    },
    {
        key: "six-thinking-hats",
        title: "Six Thinking Hats",
        tagline: "Facts, feelings, benefits, risks, alternatives — one at a time.",
        description:
            "For a question the room keeps arguing about in circles. Everyone thinks in the same direction at the same time: first the facts, then gut reactions, then benefits, then risks, then alternatives, and finally the decision. Parallel thinking replaces adversarial debate.",
        objectiveTemplate: "Work through <question> hat by hat and land on a decision",
        agenda: [
            "White: facts",
            "Red: gut reactions",
            "Yellow: benefits",
            "Black: risks",
            "Green: alternatives",
            "Blue: decision",
        ],
        agents: ["facilitator", "analyst", "support", "marketing", "counsel", "product"],
        turnPolicy: "moderated",
        moderator: "facilitator",
        category: "decide",
        basis: {
            name: "Six Thinking Hats",
            origin: "Edward de Bono (1985). Parallel thinking: the group wears one hat at a time instead of arguing positions.",
            usedBy: "Facilitation practice worldwide; standard templates in Miro, Mural and SessionLab.",
            url: "https://www.sessionlab.com/methods/six-thinking-hats",
        },
        phases: [
            {
                id: "blue-open",
                title: "Blue hat: set up",
                goal: "Name the question and how the hats will run. No content yet.",
                turns: 1,
                speakers: ["facilitator"],
            },
            {
                id: "white",
                title: "White hat: facts",
                goal: "Only what the sources say. Numbers, dates, quotes with citations. No interpretation.",
                turns: 2,
                speakers: ["analyst"],
            },
            {
                id: "red",
                title: "Red hat: gut",
                goal: "First reactions from the customer's and the market's side, stated as feelings, without justification.",
                turns: 2,
                speakers: ["support", "marketing"],
            },
            {
                id: "yellow",
                title: "Yellow hat: benefits",
                goal: "The upside, and the reasons it could work. Be specific about value.",
                turns: 2,
                speakers: ["marketing", "product"],
            },
            {
                id: "black",
                title: "Black hat: risks",
                goal: "What could go wrong, what is missing, where it fails. Cautions, with the clause or number behind each.",
                turns: 2,
                speakers: ["counsel", "analyst"],
            },
            {
                id: "green",
                title: "Green hat: alternatives",
                goal: "New options and modifications that answer the black hat.",
                turns: 2,
                speakers: ["product", "marketing"],
            },
            {
                id: "blue-close",
                title: "Blue hat: decide",
                goal: "Summarise what each hat produced and state the decision, the owner and the next step.",
                turns: 1,
                speakers: ["facilitator"],
            },
        ],
    },
    {
        key: "lightning-decision-jam",
        title: "Lightning decision jam",
        tagline: "Problems, then priorities, then solutions — no open discussion.",
        description:
            "For a team that talks a lot and decides little. Everyone names what is working and what is not, the chair prioritises, the biggest problem is reframed as a 'how might we', everyone proposes solutions, and one becomes an experiment with an owner. Written turns keep it from turning into a debate.",
        objectiveTemplate: "Pick one experiment to run against the biggest problem in <area>",
        agenda: [
            "What is working",
            "What is not",
            "The problem to solve",
            "Solutions",
            "The experiment",
        ],
        agents: ["facilitator", "product", "engineer", "sales", "support", "critic"],
        turnPolicy: "round_robin",
        category: "decide",
        basis: {
            name: "Lightning Decision Jam (LDJ)",
            origin: "Jonathan Courtney, AJ&Smart (2017), distilled from the Google Ventures design sprint's decision techniques.",
            usedBy: "AJ&Smart's workshops; templates in Miro, Mural and the Open Practice Library.",
            url: "https://www.sessionlab.com/methods/lightning-decision-jam-ldj",
        },
        phases: [
            {
                id: "working",
                title: "What is working",
                goal: "One line each on what is going well. No discussion.",
                turns: 5,
                speakers: ["product", "engineer", "sales", "support", "critic"],
            },
            {
                id: "problems",
                title: "What is not",
                goal: "One line each on the biggest problem or blocker. Still no discussion.",
                turns: 5,
                speakers: ["product", "engineer", "sales", "support", "critic"],
            },
            {
                id: "prioritise",
                title: "Prioritise and reframe",
                goal: "Pick the one problem worth solving now and restate it as 'How might we …'.",
                turns: 1,
                speakers: ["facilitator"],
            },
            {
                id: "solutions",
                title: "Solutions",
                goal: "One concrete solution each to the 'how might we'. Concrete enough to try in a week.",
                turns: 4,
                speakers: ["product", "engineer", "sales", "support"],
            },
            {
                id: "decide",
                title: "Decide the experiment",
                goal: "Choose the solution with the best effort-to-impact, define the smallest test, name the owner and the date.",
                turns: 2,
                speakers: ["facilitator", "critic"],
            },
        ],
    },

    // ------------------------------------------------------------------
    // Review something
    // ------------------------------------------------------------------
    {
        key: "premortem",
        title: "Pre-mortem",
        tagline: "It is a year later and the plan failed. Why?",
        description:
            "Run before committing to a plan. Everyone assumes the plan has already failed and writes down why — prospective hindsight surfaces risks people would not raise as objections. The room then ranks the causes and assigns a mitigation to each one that matters.",
        objectiveTemplate:
            "Find the ways <plan> fails and assign a mitigation to each one that matters",
        agenda: [
            "The plan as it stands",
            "How it failed",
            "Which causes matter",
            "Mitigations and owners",
        ],
        agents: ["facilitator", "engineer", "finance", "sales", "counsel", "critic"],
        turnPolicy: "moderated",
        moderator: "facilitator",
        category: "review",
        basis: {
            name: "Pre-mortem",
            origin: "Gary Klein, 'Performing a Project Premortem', Harvard Business Review (2007). Builds on Mitchell, Russo & Pennington (1989): prospective hindsight raises correct identification of reasons for an outcome by about 30%.",
            usedBy: "Atlassian Team Playbook, Kahneman's recommended practice in Thinking, Fast and Slow, and product and engineering teams before launches.",
            url: "https://hbr.org/2007/09/performing-a-project-premortem",
        },
        phases: [
            {
                id: "brief",
                title: "Brief the plan",
                goal: "State the plan as it stands and the outcome it is meant to produce. Then: 'It is twelve months on and it failed.'",
                turns: 1,
                speakers: ["facilitator"],
            },
            {
                id: "imagine",
                title: "Imagine the failure",
                goal: "From your seat, say how it failed — two or three concrete reasons, the more specific the better. No solutions yet.",
                turns: 5,
                speakers: ["engineer", "finance", "sales", "counsel", "critic"],
            },
            {
                id: "rank",
                title: "Rank the causes",
                goal: "Consolidate the reasons; agree the three most likely and most costly.",
                turns: 2,
                speakers: ["facilitator", "critic"],
            },
            {
                id: "mitigate",
                title: "Mitigate",
                goal: "One mitigation per top cause, with an owner and a trigger that tells you it is happening.",
                turns: 3,
            },
        ],
    },
    {
        key: "prfaq-review",
        title: "Working-backwards PR/FAQ review",
        tagline: "Start from the customer's press release; work back to what must be true.",
        description:
            "For a new product, feature or initiative. Amazon's working-backwards discipline: state the idea as the press release a customer would read, answer the five customer questions, then take the hard internal FAQ — what has to be true, what it costs, what could kill it — and give a verdict.",
        objectiveTemplate: "Review the PR/FAQ for <idea> and decide: proceed, refine, or stop",
        agenda: ["The press release", "The customer questions", "The hard FAQ", "Verdict"],
        agents: ["facilitator", "product", "support", "engineer", "finance", "critic"],
        turnPolicy: "moderated",
        moderator: "facilitator",
        category: "review",
        basis: {
            name: "Working Backwards PR/FAQ",
            origin: "Amazon's product-development process, described by Colin Bryar and Bill Carr in Working Backwards (2021): write the press release and FAQ first, iterate until the customer experience is clear.",
            usedBy: "Amazon and AWS for new products; widely adopted by product teams as the PR/FAQ document.",
            url: "https://workingbackwards.com/concepts/working-backwards-pr-faq-process/",
        },
        phases: [
            {
                id: "pr",
                title: "The press release",
                goal: "Read the idea as a press release: headline, who it is for, the problem, the benefit, a customer quote. If none exists, draft it.",
                turns: 1,
                speakers: ["facilitator"],
            },
            {
                id: "customer",
                title: "The customer questions",
                goal: "Who is the customer, what is the problem, what is the most important benefit, how do we know they need it, what does the experience look like — answered from the sources and the customer's voice.",
                turns: 2,
                speakers: ["product", "support"],
            },
            {
                id: "hard-faq",
                title: "The hard FAQ",
                goal: "The internal questions: what has to be true, what it costs to build and run, what the economics look like, what could kill it.",
                turns: 3,
                speakers: ["engineer", "finance", "critic"],
            },
            {
                id: "verdict",
                title: "Verdict",
                goal: "Proceed, refine or stop — with the reason, and the next step for whichever it is.",
                turns: 2,
                speakers: ["facilitator", "product"],
            },
        ],
    },
    {
        key: "pitch-review",
        title: "Pitch review",
        tagline:
            "Purpose, problem, solution, why now, market, model, team — the investor's outline.",
        description:
            "For a deck, a memo or an application. The room reads the pitch the way an investor does, section by section on Sequoia's outline, and finishes with the three questions the founder will get asked and how to answer them.",
        objectiveTemplate:
            "Review the pitch for <company or round> and list the questions an investor will ask",
        agenda: [
            "Purpose and problem",
            "Solution and why now",
            "Market and competition",
            "Business model and financials",
            "Team, ask, and the hard questions",
        ],
        agents: ["facilitator", "product", "marketing", "analyst", "finance", "critic"],
        turnPolicy: "moderated",
        moderator: "facilitator",
        category: "review",
        basis: {
            name: "Sequoia's business-plan outline",
            origin: "Sequoia Capital, 'Writing a Business Plan': company purpose, problem, solution, why now, market size, competition, product, business model, team, financials — in as few words as possible.",
            usedBy: "The default pitch-deck structure across venture; the outline behind most deck templates.",
            url: "https://sequoiacap.com/article/writing-a-business-plan",
        },
        phases: [
            {
                id: "purpose",
                title: "Purpose and problem",
                goal: "Is the company defined in one declarative sentence, and is the customer's pain concrete — how do they handle it today?",
                turns: 2,
                speakers: ["facilitator", "product"],
            },
            {
                id: "solution",
                title: "Solution and why now",
                goal: "Does the solution make the customer's life better in a way they would repeat, and what changed recently that makes it possible?",
                turns: 2,
                speakers: ["marketing", "product"],
            },
            {
                id: "market",
                title: "Market and competition",
                goal: "The market size with its arithmetic, and who else the customer could choose — with the sources' numbers, not the deck's adjectives.",
                turns: 2,
                speakers: ["analyst", "marketing"],
            },
            {
                id: "model",
                title: "Business model and financials",
                goal: "How the money works: pricing, margin, the key assumptions, and what the numbers say about runway and the ask.",
                turns: 2,
                speakers: ["finance", "analyst"],
            },
            {
                id: "questions",
                title: "The hard questions",
                goal: "The three questions an investor will ask, ranked by how badly the answer would go today, and how to answer each.",
                turns: 3,
                speakers: ["critic", "finance", "facilitator"],
            },
        ],
    },
    {
        key: "retrospective-4ls",
        title: "Retrospective (4Ls)",
        tagline: "Loved, loathed, longed for, learned — then actions.",
        description:
            "After a launch, a sprint or a bad week. Each seat says what it loved, loathed, longed for and learned; the chair turns the loathed and longed-for into a short list of actions with owners.",
        objectiveTemplate: "Run a retrospective on <period or project> and agree the actions",
        agenda: ["Loved", "Loathed", "Longed for", "Learned", "Actions"],
        agents: ["facilitator", "product", "engineer", "sales", "support"],
        turnPolicy: "round_robin",
        category: "review",
        basis: {
            name: "4Ls retrospective",
            origin: "Mary Gorman and Ellen Gottesdiener (2010); documented as a play in the Atlassian Team Playbook.",
            usedBy: "Agile teams' sprint retrospectives; built-in templates in Jira, Miro and Retrium.",
            url: "https://www.atlassian.com/team-playbook/plays/4-ls-retrospective-technique",
        },
        phases: [
            {
                id: "loved",
                title: "Loved",
                goal: "What went well and should keep happening. One or two things each, from the evidence.",
                turns: 4,
                speakers: ["product", "engineer", "sales", "support"],
            },
            {
                id: "loathed",
                title: "Loathed",
                goal: "What made things worse or was missing. Specific, not personal.",
                turns: 4,
                speakers: ["product", "engineer", "sales", "support"],
            },
            {
                id: "longed",
                title: "Longed for",
                goal: "What you wish you had had: tools, information, time, decisions.",
                turns: 4,
                speakers: ["product", "engineer", "sales", "support"],
            },
            {
                id: "learned",
                title: "Learned",
                goal: "What the period taught us that changes how we work next time.",
                turns: 2,
            },
            {
                id: "actions",
                title: "Actions",
                goal: "Turn the loathed and longed-for into at most five actions with owners and dates.",
                turns: 1,
                speakers: ["facilitator"],
            },
        ],
    },

    // ------------------------------------------------------------------
    // Explore a question
    // ------------------------------------------------------------------
    {
        key: "customer-discovery",
        title: "Customer discovery synthesis",
        tagline: "From what they said to what we do — without fooling ourselves.",
        description:
            "Point it at interviews, tickets, reviews or call notes. The customer voice reports what people said with counts, product names the forces behind a switch, sales separates compliments from commitments, and the room agrees the next interviews or experiments.",
        objectiveTemplate:
            "Synthesise the customer evidence in <sources> into what to build, test or ask next",
        agenda: [
            "What they said, with counts",
            "The forces behind a switch",
            "Commitments versus compliments",
            "Next interviews and experiments",
        ],
        agents: ["facilitator", "support", "product", "sales", "analyst"],
        turnPolicy: "moderated",
        moderator: "facilitator",
        category: "explore",
        basis: {
            name: "The Mom Test + jobs-to-be-done forces",
            origin: "Rob Fitzpatrick, The Mom Test (2013): talk about their life, ask about specifics in the past, listen; and the four forces of a switch (push, pull, anxiety, habit) from Bob Moesta's JTBD interviewing.",
            usedBy: "Customer-discovery practice in accelerators and product teams; the interview standard YC and Lean Startup courses teach.",
        },
        phases: [
            {
                id: "said",
                title: "What they said",
                goal: "The recurring problems and requests in the customers' own words, with how often each came up and where.",
                turns: 2,
                speakers: ["support", "analyst"],
            },
            {
                id: "forces",
                title: "The forces",
                goal: "For the top themes: what pushes people away from today's way, what pulls them to a new one, what makes them anxious, and the habit that holds them.",
                turns: 2,
                speakers: ["product", "support"],
            },
            {
                id: "signal",
                title: "Commitments versus compliments",
                goal: "Which of this is signal — time, money or reputation committed — and which is politeness.",
                turns: 2,
                speakers: ["sales", "analyst"],
            },
            {
                id: "next",
                title: "Next interviews and experiments",
                goal: "What to ask the next five customers, what to test, and who does it.",
                turns: 2,
                speakers: ["facilitator", "product"],
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

    // ------------------------------------------------------------------
    // Run a routine
    // ------------------------------------------------------------------
    {
        key: "weekly-business-review",
        title: "Weekly business review",
        tagline: "Inputs, outputs, exceptions, next steps — in that order.",
        description:
            "The standing weekly meeting over the week's numbers and notes. Controllable input metrics first, then the outputs they are meant to move and the variances, then only the exceptions, then next steps with owners. No storytelling around a number that is on track.",
        objectiveTemplate: "Review the week for <company or team> and agree next steps",
        agenda: ["Input metrics", "Output metrics and variances", "Exceptions", "Next steps"],
        agents: ["facilitator", "analyst", "finance", "sales", "product"],
        turnPolicy: "moderated",
        moderator: "facilitator",
        category: "run",
        basis: {
            name: "Amazon Weekly Business Review (WBR)",
            origin: "Amazon's metrics meeting, described in Bryar & Carr's Working Backwards (2021): a deck of input and output metrics, reviewed for variance and exceptions, ending in actions.",
            usedBy: "Amazon; adopted by operators as the WBR, with templates from Working Backwards LLC and Commoncog.",
            url: "https://commoncog.com/the-amazon-weekly-business-review/",
        },
        phases: [
            {
                id: "inputs",
                title: "Input metrics",
                goal: "The metrics the team controls — activity, pipeline created, shipped, tickets closed — with this week's numbers against the trend, from the sources.",
                turns: 2,
                speakers: ["analyst", "finance"],
            },
            {
                id: "outputs",
                title: "Outputs and variances",
                goal: "Revenue, margin, retention: what moved, what did not, and the variance that needs a reason.",
                turns: 2,
                speakers: ["finance", "sales"],
            },
            {
                id: "exceptions",
                title: "Exceptions",
                goal: "Only the numbers off-plan. For each: the cause, whether it is fixed, who owns it.",
                turns: 3,
                speakers: ["sales", "product", "analyst"],
            },
            {
                id: "next",
                title: "Next steps",
                goal: "Actions with owners and dates. Close.",
                turns: 1,
                speakers: ["facilitator"],
            },
        ],
    },
    {
        key: "okr-setting",
        title: "OKR setting",
        tagline: "One objective, three measurable key results, stress-tested.",
        description:
            "For a quarter or a launch. Draft the objective, have each function propose key results, then test them: measurable, ambitious, outcomes rather than tasks, few enough to remember. Commit to what survives.",
        objectiveTemplate: "Set the OKRs for <quarter or initiative>",
        agenda: ["The objective", "Key results by function", "Stress test", "Commit"],
        agents: ["facilitator", "product", "sales", "engineer", "finance", "critic"],
        turnPolicy: "moderated",
        moderator: "facilitator",
        category: "run",
        basis: {
            name: "OKRs",
            origin: "Andy Grove's objectives and key results at Intel, brought to Google by John Doerr and set out in Measure What Matters (2018).",
            usedBy: "Google, and most of the startup ecosystem; the default goal framework in Lattice, Asana Goals and Notion templates.",
            url: "https://www.whatmatters.com/faqs/okr-meaning-definition-example",
        },
        phases: [
            {
                id: "objective",
                title: "The objective",
                goal: "One qualitative, memorable objective for the period. Say why it matters now.",
                turns: 2,
                speakers: ["facilitator", "product"],
            },
            {
                id: "key-results",
                title: "Key results",
                goal: "Each function proposes one key result: a number, a baseline, a target, a date.",
                turns: 4,
                speakers: ["product", "sales", "engineer", "finance"],
            },
            {
                id: "stress",
                title: "Stress test",
                goal: "Is each key result measurable, ambitious, an outcome rather than a task, and are there few enough to remember? Cut or rewrite.",
                turns: 2,
                speakers: ["critic", "finance"],
            },
            {
                id: "commit",
                title: "Commit",
                goal: "The objective and the surviving key results, each with an owner. Close.",
                turns: 1,
                speakers: ["facilitator"],
            },
        ],
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
