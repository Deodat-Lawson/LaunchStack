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
 *   POST   /api/scenarios  { contractVersion: 2, … } + Idempotency-Key header
 *                                                → 201 { run, runId, requestSpecId, worldSpecId: null }
 *                                                  same key + payload → 200 with the original run; other payload → 409
 *   GET    /api/scenarios/:id/provenance?after&limit → ScenarioProvenance   (v2)
 *   GET    /api/scenarios/:id/trace?afterSeq&limit   → ScenarioTrace        (v2)
 *   POST   /api/scenarios/:id/replay {mode:"recorded"} → ScenarioReplay     (v2, finished runs)
 *   POST   /api/brand/post-tests CreatePostTestInput → { test: PostTestResult } needs social.publish
 *   GET    /api/brand/post-tests/:id              → { test: PostTestResult }
 *   GET    /api/brand/post-tests/track-record     → { record: TrackRecord }
 *   POST   /api/brand/posts accepts `postTestId` and then answers with `postTest: PostTestLink`.
 * Errors are `{ error: string }` with a 4xx/5xx status.
 */

export type ScenarioKind = "scenario" | "post_test";

export type ScenarioStatus = "queued" | "running" | "done" | "failed" | "cancelled";

/** Where a running scenario is, for progress copy. "grounding" is v2 only (ontology and evidence graph). */
export type ScenarioStage =
    | "gathering"
    | "grounding"
    | "casting"
    | "simulating"
    | "reporting"
    | "done";

export const SCENARIO_LIMITS = {
    agents: { min: 5, max: 200, default: 30 },
    rounds: { min: 1, max: 30, default: 8 },
    postTest: { agents: 20, rounds: 3 },
    /** Room for a plan, the actions behind it and where things stand; longer material goes in files. */
    subjectMax: 4000,
    notesMax: 8000,
    eventMax: 500,
    questionMax: 600,
    documentsMax: 20,
} as const;

/**
 * The line every scenario surface shows, in English. Screens say it in the
 * reader's language with `useTranslations("scenarios.words")("caveat")`.
 */
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

/** How each person's context is assembled in a v2 run. */
export type ScenarioContextMode = "passage" | "facts" | "graph";

export interface CreateScenarioInput {
    /** 2 starts a durable, evidence-grounded run; absent or 1 is the original loop. */
    contractVersion?: 1 | 2;
    /** v2: the context mode to ask for; the server falls back (and says why) when it can't. */
    contextMode?: ScenarioContextMode;
    title?: string;
    /**
     * The situation or question, e.g. "We raise prices 20% for new customers in
     * January." — or a few paragraphs: the plan, the actions, the current cases.
     */
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

/**
 * Whether a file's passages can be read yet: a file still being processed
 * gives a run nothing, so the form waits for it.
 */
export type ScenarioFileStatus = "ready" | "processing" | "failed";

/** One file the new-scenario form can offer. */
export interface ScenarioFileOption {
    id: number;
    title: string;
    folder: string | null;
    /** As stored, for the file's icon; null when the upload did not say. */
    mimeType: string | null;
    addedAt: string;
    status: ScenarioFileStatus;
    /** The company profile counts it as written by or about the company. */
    aboutCompany: boolean;
}

/** What the new-scenario form can offer. */
export interface ScenarioSourceOptions {
    /** Newest first. */
    documents: ScenarioFileOption[];
    prospects: number;
    brandComments: number;
    companyProfile: boolean;
    /** The viewer may add files to the workspace from the form. */
    canUpload: boolean;
    /**
     * Whether the workspace has its beta apps on. Prospects and post comments
     * are Growth's, a beta app: while it is off the form offers neither (and
     * both counts are 0). Missing from an older server: offered as before.
     */
    betaApps?: boolean;
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
    /** 1 for the original loop, 2 for durable, evidence-grounded runs. */
    contractVersion: 1 | 2;
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

/** What a person has to spend: nothing set aside, little, or a budget for the right thing. */
export type ScenarioBudget = "none" | "tight" | "funded";
/** Their part in a purchase. */
export type ScenarioBuyingRole = "decides" | "influences" | "uses";
/** What moving off their current tool would cost them. */
export type ScenarioSwitchingCost = "low" | "medium" | "high";
/** Whether they'd spend money on what's on offer, as things stand. */
export type ScenarioWouldPay = "yes" | "maybe" | "no";

export interface ScenarioPerson {
    id: string;
    name: string;
    /** With its leading "@", e.g. "@dana_ops" (as are all handles in this contract). */
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
    // The wallet, from the cast. Null in runs cast before it was asked for.
    /** What they use for this today, e.g. a named product, "Spreadsheets" or "nothing". */
    currentSolution: string | null;
    budget: ScenarioBudget | null;
    buyingRole: ScenarioBuyingRole | null;
    switchingCost: ScenarioSwitchingCost | null;
    /** Their first doubt, in their own words. */
    firstObjection: string | null;
    /** Whether they'd pay, as of their last turn; null before their first. */
    wouldPay: ScenarioWouldPay | null;
    /** What still held them back on their last turn. */
    objection: string | null;
    /**
     * v2: where each cast field came from. Null for runs cast before v2.
     * A field missing from the map has no recorded basis.
     */
    basis: Partial<Record<ScenarioAttributedField, ScenarioFieldBasis>> | null;
}

/** Cast fields that carry a basis in v2 runs. */
export type ScenarioAttributedField =
    | "role"
    | "currentSolution"
    | "budget"
    | "buyingRole"
    | "switchingCost"
    | "objection";

/** source: read in the evidence; inferred: reasoned from it; assumed: a stated default; unknown: not known. */
export type ScenarioBasis = "source" | "inferred" | "assumed" | "unknown";

export interface ScenarioFieldBasis {
    basis: ScenarioBasis;
    /** Source ids ("E2") behind it. */
    sources: string[];
    /** Why, for inferred and assumed values. */
    explanation: string | null;
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
    /** Numbers per completed round (the summary's `rounds` is the planned count). */
    roundStats: ScenarioRoundStats[];
    report: ScenarioReport | null;
    reception: ScenarioReception | null;
    injections: ScenarioInjection[];
    /** Events can still be added: the final round hasn't started. */
    eventsOpen: boolean;
    error: string | null;
    estimate: { calls: number; credits: number };
    usage: { calls: number; credits: number };
    /** The creator may cancel, inject events, share, rename and delete. */
    canManage: boolean;
    /** Post tests only: the draft that was tested. */
    draft: { text: string; networks: string[] } | null;
    /** v2 only: grounding, coverage and completeness. Null for v1 runs. */
    v2: ScenarioV2Detail | null;
}

export type ScenarioOmissionReason = "budget" | "not_ready" | "no_access" | "empty" | "unsupported";

/** A selected source the run didn't read, and why. */
export interface ScenarioOmission {
    label: string;
    kind: ScenarioSource["kind"];
    reason: ScenarioOmissionReason;
    /** True when the viewer can't see the file; the label is withheld. */
    redacted: boolean;
}

export type ScenarioFallbackReason =
    | "graph_not_configured"
    | "graph_unavailable"
    | "workspace_endpoint"
    | "no_documents";

export interface ScenarioV2Detail {
    /** sha-256 of the frozen request spec. */
    specHash: string | null;
    /** sha-256 of the frozen world, once the cast is final. */
    worldSpecHash: string | null;
    contextMode: ScenarioContextMode;
    /** Why the run isn't in the mode it asked for. */
    fallbackReason: ScenarioFallbackReason | null;
    coverage: {
        /** Captured passages and facts. */
        sections: number;
        /** Files they came from. */
        files: number;
        omitted: ScenarioOmission[];
    };
    /** Rounds where more than a third of the turns failed. */
    degradedRounds: number[];
    /** Turns that failed and were skipped. */
    skippedTurns: number;
    /** Cast slots that stayed empty after repair. */
    unfilledSlots: number;
    /** Physical model attempts by outcome; unknown ones may still have cost money. */
    attempts: { succeeded: number; failed: number; unknown: number };
    /** A finished run can be replayed from its recorded turns with no model calls. */
    replayAvailable: boolean;
    /** Set while the run waits on the graph service. */
    waitingSince: string | null;
}

/** GET /api/scenarios/:id/provenance */
export interface ScenarioProvenance {
    runId: number;
    specHash: string | null;
    manifestHash: string | null;
    contextMode: ScenarioContextMode;
    fallbackReason: ScenarioFallbackReason | null;
    /** Captured evidence with where it sits in its source. */
    sources: Array<
        ScenarioSource & {
            page: number | null;
            section: string | null;
            versionId: string | null;
            contentHash: string | null;
        }
    >;
    omitted: ScenarioOmission[];
    ontology: {
        ontologyHash: string;
        entities: Array<{ name: string; origin: "base" | "extension"; source: string | null }>;
        edges: Array<{
            name: string;
            endpoints: Array<{ source: string; target: string }>;
            origin: "base" | "extension";
            source: string | null;
        }>;
        valid: boolean;
        repairs: number;
    } | null;
    graph: {
        graphHash: string;
        nodes: number;
        edges: number;
        supportedEdges: number;
        unresolvedIdentities: number;
    } | null;
    /** One per cast slot, paged. */
    contexts: Array<{
        slotId: string;
        personId: string | null;
        segment: string;
        mode: ScenarioContextMode;
        facts: Array<{ text: string; sources: string[] }>;
        passages: string[];
        tokens: number;
        contextHash: string;
    }>;
    /** Pass as `after` for the next page of contexts; null at the end. */
    nextAfter: string | null;
}

/** GET /api/scenarios/:id/trace */
export interface ScenarioTrace {
    runId: number;
    stage: ScenarioStage;
    /** Units committed so far. */
    committed: number;
    /** Milliseconds since the driver last renewed its lease; null when none holds it. */
    heartbeatAgeMs: number | null;
    units: Array<{
        seq: number;
        key: string;
        kind: string;
        status: "pending" | "running" | "committed" | "failed" | "skipped";
        attempts: number;
        credits: number;
        durationMs: number | null;
        /** A classified error code, never provider text. */
        error: string | null;
        calls: number;
        callAttempts: { succeeded: number; failed: number; unknown: number };
    }>;
    nextAfterSeq: number | null;
}

/** POST /api/scenarios/:id/replay */
export interface ScenarioReplay {
    available: boolean;
    reason: "replay_unavailable" | "not_finished" | "unsupported_version" | null;
    matches: boolean;
    modelCalls: 0;
    rounds: Array<{ round: number; expected: string; actual: string; matches: boolean }>;
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
    sampleComments: Array<{
        name: string;
        handle: string;
        role: string;
        text: string;
        stance: Stance;
    }>;
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
