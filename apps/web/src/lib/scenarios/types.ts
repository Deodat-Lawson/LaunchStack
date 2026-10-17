/**
 * The Scenarios wire contract — what `/api/scenarios/**` and
 * `/api/brand/post-tests/**` return. Client-safe: no server imports.
 *
 * A scenario is a simulated social network (a TypeScript port of the OASIS
 * design, `@launchstack/simulation`): people built from the workspace's own
 * records react to a situation over several rounds. A post test is the same
 * run with a draft Brand post as the opening post.
 *
 * Endpoints (all need a signed-in workspace member):
 *   GET    /api/scenarios                         → { runs: ScenarioSummary[] }   mine + shared, kind "scenario"
 *   GET    /api/scenarios/sources                 → ScenarioSourceOptions
 *   POST   /api/scenarios/estimate {agents,rounds}→ ScenarioEstimate
 *   POST   /api/scenarios  CreateScenarioInput    → { run: ScenarioSummary }   402 { code: "insufficient_credits" }
 *   GET    /api/scenarios/:id                     → { run: ScenarioDetail }    poll every 2 s while queued/running
 *   PATCH  /api/scenarios/:id {title?, shared?}   → { run: ScenarioSummary }   creator only
 *   DELETE /api/scenarios/:id                     → { ok: true }               creator only
 *   POST   /api/scenarios/:id/cancel              → { run: ScenarioSummary }   creator only
 *   POST   /api/scenarios/:id/events {text}       → { injection }              creator only, 409 unless running
 *   GET    /api/scenarios/:id/interviews          → { interviews: ScenarioInterview[] }  the viewer's own
 *   POST   /api/scenarios/:id/interviews {agentId, question} → { interview }  409 before round 1 finishes
 *   POST   /api/brand/post-tests CreatePostTestInput → { test: PostTestResult } needs social.publish
 *   GET    /api/brand/post-tests/:id              → { test: PostTestResult }
 *   GET    /api/brand/post-tests/track-record     → { record: TrackRecord }
 *   POST   /api/brand/posts accepts `postTestId` and then answers with `postTest: PostTestLink`.
 * Errors are `{ error: string }` with a 4xx/5xx status.
 */

export type ScenarioKind = "scenario" | "post_test";

export type ScenarioStatus = "queued" | "running" | "done" | "failed" | "cancelled";

/** Where a running scenario is, for progress copy. */
export type ScenarioStage = "gathering" | "casting" | "simulating" | "reporting" | "done";

export const SCENARIO_LIMITS = {
    agents: { min: 5, max: 200, default: 30 },
    rounds: { min: 1, max: 30, default: 8 },
    postTest: { agents: 20, rounds: 3 },
    subjectMax: 600,
    notesMax: 8000,
    eventMax: 500,
    questionMax: 600,
    documentsMax: 20,
} as const;

/** The line every scenario surface shows. */
export const SCENARIO_CAVEAT =
    "A scenario among simulated people built from your records — something to think with, not a forecast.";

export interface ScenarioSources {
    /** Files the creator picked (only files they can see are used). */
    documentIds: number[];
    /** Also search the creator's visible files for material relevant to the subject. */
    searchFiles: boolean;
    /** Prospect companies from Growth › Prospects. */
    prospects: boolean;
    /** Comments people left on the workspace's social posts. */
    brandComments: boolean;
    /** The company profile (facts the creator can see). */
    companyProfile: boolean;
    /** Pasted material: a news story, a policy draft, an announcement. */
    notes: string;
}

export interface CreateScenarioInput {
    title?: string;
    /** The situation or question, e.g. "We raise prices 20% for new customers in January." */
    subject: string;
    sources: ScenarioSources;
    agents: number;
    rounds: number;
}

export interface ScenarioEstimate {
    agents: number;
    rounds: number;
    /** Expected model calls for the whole run. */
    calls: number;
    /** Expected credits for the whole run. */
    credits: number;
    /** Current workspace balance, null when metering is off. */
    balance: number | null;
    /** False when metering is enforced and the balance is short. */
    enough: boolean;
}

/** What the new-scenario form can offer. */
export interface ScenarioSourceOptions {
    documents: Array<{ id: number; title: string; folder: string | null }>;
    prospects: number;
    brandComments: number;
    companyProfile: boolean;
}

export interface ScenarioSummary {
    id: number;
    kind: ScenarioKind;
    title: string;
    subject: string;
    status: ScenarioStatus;
    stage: ScenarioStage;
    /** Rounds completed so far. */
    round: number;
    rounds: number;
    agents: number;
    createdAt: string;
    finishedAt: string | null;
    createdByMe: boolean;
    /** Display name of the creator ("You" is the client's job). */
    createdByName: string;
    shared: boolean;
    /** The report headline once done. */
    headline: string | null;
}

/** One piece of evidence people were built from. Redacted when the viewer can't see the file. */
export interface ScenarioSource {
    /** "E1", "E2", … as cited by people and the brief. */
    id: string;
    kind: "document" | "search" | "prospect" | "brand_comment" | "company_profile" | "notes";
    label: string;
    excerpt: string | null;
    /** Where to open it in the app, when it has a home. */
    href: string | null;
    /** True when the viewer can't see the underlying file; label and excerpt are withheld. */
    redacted: boolean;
}

export type Stance = -2 | -1 | 0 | 1 | 2;

export interface ScenarioPerson {
    id: string;
    name: string;
    handle: string;
    role: string;
    bio: string;
    interests: string[];
    /** "grounded" cites at least one source; "invented" fills a gap and says so. */
    grounding: "grounded" | "invented";
    /** Source ids ("E3") this person is built from. */
    sources: string[];
    startStance: Stance;
    stance: Stance;
    /** Stance after each round, index 0 = start. */
    stanceHistory: Stance[];
    activity: number;
    followers: number;
    following: number;
    posts: number;
    comments: number;
    /** The person's last private reasoning. */
    lastThought: string | null;
}

export interface ScenarioComment {
    id: string;
    authorId: string;
    authorName: string;
    authorHandle: string;
    round: number;
    text: string;
}

export interface ScenarioPost {
    id: string;
    authorId: string;
    authorName: string;
    authorHandle: string;
    /** "narrator" posts the opening post and injected events; "brand" is the draft under test. */
    authorKind: "agent" | "narrator" | "brand";
    round: number;
    kind: "seed" | "event" | "post" | "repost" | "quote";
    text: string;
    root: { id: string; authorHandle: string; text: string } | null;
    likes: number;
    dislikes: number;
    shares: number;
    comments: ScenarioComment[];
}

export interface ScenarioRoundStats {
    round: number;
    active: number;
    posts: number;
    comments: number;
    likes: number;
    dislikes: number;
    shares: number;
    follows: number;
    meanStance: number;
    /** People at each stance after the round: index 0 = -2 … 4 = +2. */
    stanceCounts: [number, number, number, number, number];
}

export interface ScenarioReport {
    headline: string;
    summary: string;
    dynamics: Array<{ text: string; postIds: string[] }>;
    turningPoints: Array<{ round: number; text: string; postIds: string[] }>;
    factions: Array<{
        stance: "supportive" | "neutral" | "critical";
        label: string;
        text: string;
        /** 0–1 share of all people. */
        share: number;
        agentIds: string[];
    }>;
    watchFor: string[];
}

/** How the opening post was received (post tests). */
export interface ScenarioReception {
    postId: string;
    exposed: number;
    engaged: number;
    /** engaged / exposed, 0–1. */
    engagementRate: number;
    likes: number;
    dislikes: number;
    comments: number;
    shares: number;
    /** Mean stance of people who saw it, at the start and at the end. */
    startingSentiment: number;
    sentiment: number;
}

export interface ScenarioInjection {
    id: number;
    text: string;
    /** The round it appeared in; null while waiting for the next round. */
    round: number | null;
    createdAt: string;
}

export interface ScenarioDetail extends ScenarioSummary {
    /** Background everyone in the run knows, with [E#] citations. */
    brief: string | null;
    sourcesUsed: ScenarioSources;
    sources: ScenarioSource[];
    people: ScenarioPerson[];
    /** All posts, oldest first. */
    posts: ScenarioPost[];
    rounds: ScenarioRoundStats[];
    report: ScenarioReport | null;
    reception: ScenarioReception | null;
    injections: ScenarioInjection[];
    error: string | null;
    estimate: { calls: number; credits: number };
    usage: { calls: number; credits: number };
    /** The creator may cancel, inject events, share, rename and delete. */
    canManage: boolean;
    /** Post tests only: the draft that was tested. */
    draft: { text: string; networks: string[] } | null;
}

export interface ScenarioInterview {
    id: number;
    /** A person's id, or "analyst" for questions about the whole run. */
    agentId: string;
    question: string;
    answer: string;
    createdAt: string;
}

// ─── Brand post tests ────────────────────────────────────────────────────────

export interface CreatePostTestInput {
    text: string;
    /** Networks the post is meant for, e.g. ["linkedin"]; used for the audience description. */
    networks: string[];
}

export interface PostTestResult {
    runId: number;
    status: ScenarioStatus;
    stage: ScenarioStage;
    round: number;
    rounds: number;
    /** The tested text; compare normalizeDraft(text) with the current draft to tell whether the test is stale. */
    text: string;
    reception: ScenarioReception | null;
    headline: string | null;
    sampleComments: Array<{ name: string; handle: string; role: string; text: string; stance: Stance }>;
    error: string | null;
}

/** Returned by POST /api/brand/posts when a `postTestId` was sent. */
export interface PostTestLink {
    runId: number;
    linked: boolean;
    /** True when the draft changed after the test; the test was not linked. */
    stale: boolean;
}

export interface TrackRecordRow {
    runId: number;
    /** brand_posts.id (a string id). */
    postId: string;
    network: string;
    publishedAt: string | null;
    text: string;
    /** Simulated engagement rate, 0–1. */
    predicted: number;
    /** Real engagement rate, 0–1, null until the network reports impressions. */
    actual: number | null;
}

export interface TrackRecord {
    /** Post tests linked to a post. */
    tested: number;
    /** Linked posts that are published and have a real engagement rate. */
    withResults: number;
    /** Results needed before agreement is shown. */
    minimum: number;
    /** Spearman rank correlation between predicted and actual, once there are enough results. */
    spearman: number | null;
    /** Posts the simulation put on the right side of the median. */
    hits: number;
    total: number;
    rows: TrackRecordRow[];
}

/** The form of a draft that tests are compared on (the server hashes the same). */
export function normalizeDraft(text: string): string {
    return text.replace(/\r\n/g, "\n").trim();
}
