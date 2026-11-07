/**
 * Types for a round-based social-network simulation.
 *
 * Everything in a {@link World} is plain JSON so a host can persist it between
 * rounds (one background step per round) and resume after a restart.
 */

/** Stance toward the subject of the run: -2 strongly against … +2 strongly for. */
export type Stance = -2 | -1 | 0 | 1 | 2;

/** What a persona has to spend: nothing set aside, little, or a budget for the right thing. */
export type Budget = "none" | "tight" | "funded";
export const BUDGETS: readonly Budget[] = ["none", "tight", "funded"];

/** Their part in a purchase: they decide, they sway whoever decides, or they only use it. */
export type BuyingRole = "decides" | "influences" | "uses";
export const BUYING_ROLES: readonly BuyingRole[] = ["decides", "influences", "uses"];

/** What moving off their current tool would cost them in time, data and habits. */
export type SwitchingCost = "low" | "medium" | "high";
export const SWITCHING_COSTS: readonly SwitchingCost[] = ["low", "medium", "high"];

/** Whether they would spend money on what is on offer, as things stand. */
export type WouldPay = "yes" | "maybe" | "no";
export const WOULD_PAY: readonly WouldPay[] = ["yes", "maybe", "no"];

/** One piece of evidence a persona may be grounded in. `ref` is opaque to this package. */
export interface EvidenceItem {
    /** Stable short id the model cites, e.g. "E3". */
    id: string;
    /** Free-form kind the host understands, e.g. "document", "prospect_person". */
    kind: string;
    /** Human label, e.g. a file name or "Prospect: VP Finance at a logistics firm". */
    label: string;
    /** The text the model reads. Hosts keep it short (a few hundred words). */
    text: string;
    ref: { type: string; id: string };
}

export interface Persona {
    /** "a1", "a2", … unique within a world. */
    id: string;
    name: string;
    /** "@jordan_ops" — unique within a world. */
    handle: string;
    /** One line: what they do and where. */
    role: string;
    bio: string;
    interests: string[];
    /** Starting stance toward the subject. */
    stance: Stance;
    /** Activation probability per round, 0.05–1 (OASIS `activate_prob`). */
    activity: number;
    /** 0–1: how likely others are to follow them in the starting graph. */
    influence: number;
    /** "grounded" personas cite at least one evidence id; "invented" ones fill gaps. */
    grounding: "grounded" | "invented";
    /** Evidence ids this persona is built from. Empty for invented personas. */
    sourceIds: string[];
    // The wallet. Optional because worlds cast before it was asked for don't
    // have one; `parseCast` always sets all five.
    /** What they use for this today: a product named in the evidence, a spreadsheet, or "nothing". */
    currentSolution?: string;
    budget?: Budget;
    buyingRole?: BuyingRole;
    switchingCost?: SwitchingCost;
    /** Their first doubt about the subject, in their own words. */
    objection?: string;
}

/** Accounts that post but are not simulated: the scenario narrator, the brand under test. */
export interface Account {
    id: "narrator" | "brand";
    name: string;
    handle: string;
}

export type PostKind = "seed" | "event" | "post" | "repost" | "quote";

export interface Post {
    /** "p1", "p2", … in creation order. */
    id: string;
    authorId: string;
    /** Round the post was created in (0 = before the first round). */
    round: number;
    kind: PostKind;
    text: string;
    /** For reposts and quotes: the root post (reposts of reposts resolve to the root). */
    rootId?: string;
    likes: number;
    dislikes: number;
    /** Reposts plus quotes of this post. */
    shares: number;
    comments: number;
}

export interface Comment {
    /** "c1", "c2", … */
    id: string;
    postId: string;
    authorId: string;
    round: number;
    text: string;
}

export interface Reaction {
    agentId: string;
    postId: string;
    kind: "like" | "dislike";
    round: number;
}

export interface MemoryItem {
    round: number;
    text: string;
}

export interface AgentState {
    persona: Persona;
    stance: Stance;
    /** Stance after each completed round (index 0 = starting stance). */
    stanceHistory: Stance[];
    memory: MemoryItem[];
    /** The agent's last private reasoning, shown in interviews and the run view. */
    lastThought?: string;
    /** Whether they would pay, as of their last turn. */
    wouldPay?: WouldPay;
    /** What still holds them back, as of their last turn. */
    objection?: string;
    /** Rounds this agent was activated in. */
    activeRounds: number[];
}

export type Action =
    | { type: "create_post"; text: string }
    | { type: "comment"; postId: string; text: string }
    | { type: "like"; postId: string }
    | { type: "dislike"; postId: string }
    | { type: "repost"; postId: string }
    | { type: "quote"; postId: string; text: string }
    | { type: "follow"; agentId: string }
    | { type: "do_nothing" };

export type ActionType = Action["type"];

/** What the model decided for one agent in one round. */
export interface AgentDecision {
    thought: string;
    /** The stance the model asked for; the round's stance guard decides what is applied. */
    stance: Stance;
    /** The feed post that moved them toward the subject, if they named one that was in their feed. */
    convincedBy?: string;
    wouldPay?: WouldPay;
    objection?: string;
    actions: Action[];
}

/** One applied action, as the run log records it. */
export interface ActionRecord {
    round: number;
    agentId: string;
    action: Action;
    /** Id of the post or comment the action created, if any. */
    createdId?: string;
}

export interface RoundSummary {
    round: number;
    active: number;
    /** Agents whose model call failed and were treated as doing nothing. */
    failed: number;
    posts: number;
    comments: number;
    likes: number;
    dislikes: number;
    shares: number;
    follows: number;
    /** Mean stance across all agents after the round. */
    meanStance: number;
    /** Count of agents at each stance after the round, index 0 = -2 … 4 = +2. */
    stanceCounts: [number, number, number, number, number];
    /** Agents whose last answer was yes, maybe and no; absent in worlds from before it was asked. */
    wouldPayCounts?: [number, number, number];
    usage: Usage;
}

export interface Usage {
    calls: number;
    inputTokens: number;
    outputTokens: number;
}

export interface SimulationConfig {
    /** Seed for every random choice, so a run replays identically. */
    seed: number;
    /** Multiplies each persona's activity; 1 = as written. */
    activationScale: number;
    /** Activation probability floor for round 1, so most agents see the opening post. */
    firstRoundActivation: number;
    /** Recommended posts per refresh (OASIS `max_rec_post_len`). */
    recommendCount: number;
    /** Most-liked posts from followed accounts per refresh (OASIS `following_post_count`). */
    followingCount: number;
    /** Share of recommendations swapped for random posts (OASIS `swap_rate`). */
    swapRate: number;
    /** Simulated minutes per round, used by the time decay. */
    minutesPerRound: number;
    /** Most actions one agent may take in one round. */
    maxActionsPerRound: number;
    /** Memory items kept per agent. */
    memorySize: number;
    /** Most a stance may move in one round. */
    maxStanceStep: number;
    /** A move toward the subject applies only when the agent names the feed post that caused it. */
    warmingNeedsReason: boolean;
}

export const DEFAULT_CONFIG: SimulationConfig = {
    seed: 1,
    activationScale: 1,
    firstRoundActivation: 0.8,
    recommendCount: 5,
    followingCount: 3,
    swapRate: 0.1,
    minutesPerRound: 20,
    maxActionsPerRound: 3,
    memorySize: 12,
    maxStanceStep: 1,
    warmingNeedsReason: true,
};

export interface World {
    version: 1;
    /** Completed rounds. */
    round: number;
    /** The question or subject every stance is measured against. */
    subject: string;
    /** The subject as people read it on their turns, when it is too long to repeat (see `turnSituation`). */
    situation?: string;
    /** Shared context every agent reads. */
    brief: string;
    config: SimulationConfig;
    accounts: Account[];
    agents: AgentState[];
    posts: Post[];
    comments: Comment[];
    reactions: Reaction[];
    /** [follower, followee] pairs. */
    follows: Array<[string, string]>;
    /** Post ids each agent has been shown, most recent last. */
    seen: Record<string, string[]>;
    actions: ActionRecord[];
    rounds: RoundSummary[];
    /** Next id counters. */
    nextPost: number;
    nextComment: number;
}

/** A feed entry as an agent sees it. */
export interface FeedItem {
    postId: string;
    authorId: string;
    authorName: string;
    authorHandle: string;
    kind: PostKind;
    text: string;
    /** For reposts/quotes: the root post's author handle and text. */
    root?: { handle: string; text: string };
    likes: number;
    shares: number;
    comments: number;
    recentComments: Array<{ handle: string; text: string }>;
    /** Why it was shown: pinned event, followed account, recommendation, or random swap. */
    reason: "pinned" | "following" | "recommended" | "random";
}

/** The model port. The engine builds prompts and parses replies; the host only completes text. */
export interface ModelRequest {
    purpose: "decide" | "interview" | "report" | "cast" | "brief";
    system: string;
    prompt: string;
    /** JSON schema of the expected reply, for hosts whose model supports structured output. */
    schema?: Record<string, unknown>;
    maxOutputTokens: number;
}

export interface ModelReply {
    text: string;
    usage?: { inputTokens: number; outputTokens: number };
}

export interface SimulationModel {
    complete(request: ModelRequest): Promise<ModelReply>;
}
