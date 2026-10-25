/**
 * In-memory `/api/scenarios/**` for the preview harness, answering every
 * endpoint in the wire contract (`~/lib/scenarios/types`):
 *
 * - a finished run (a price rise, twelve people, eight rounds, a full report,
 *   an event added in round 4, a file this viewer cannot open);
 * - a run in progress that finishes a round every few seconds as it is
 *   polled, so progress, live stats and "Add an event" can be watched;
 * - a failed run, a cancelled run, and a finished run someone else shared;
 * - creating a run starts a new one in progress; interviews answer with
 *   canned text; the analyst answers about the whole run.
 *
 * Switches (see ScenariosPreview): `empty` starts with no runs; `credits:
 * "short"` leaves a balance of 40 credits so the estimate blocks bigger runs;
 * `credits: "race"` passes the estimate and then answers the create with 402.
 * Time is passed in, so tests can step a run forward without waiting.
 */
import { moodWords } from "~/lib/scenarios/words";
import {
    SCENARIO_LIMITS,
    type ScenarioDetail,
    type ScenarioFileOption,
    type ScenarioInterview,
    type ScenarioKind,
    type ScenarioPerson,
    type ScenarioPost,
    type ScenarioSources,
    type ScenarioStage,
    type ScenarioStatus,
    type ScenarioSummary,
} from "~/lib/scenarios/types";

import {
    PRICE_RUN_EVENT,
    PRICE_RUN_SOURCES_USED,
    PRICE_RUN_SUBJECT,
    SOURCE_OPTIONS,
    countActivity,
    generateScript,
    priceScript,
    roundStats,
    sourcesFor,
    type Script,
} from "./world";

// ── Timing of a live run ──────────────────────────────────────────────────

export const TIMING = {
    /** An uploaded file, from registered to read. */
    reading: 6000,
    queued: 700,
    gathering: 2500,
    casting: 3000,
    round: 5000,
    reporting: 3500,
} as const;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function totalMs(rounds: number): number {
    return TIMING.gathering + TIMING.casting + rounds * TIMING.round + TIMING.reporting;
}

// ── State ─────────────────────────────────────────────────────────────────

interface SimInjection {
    id: number;
    text: string;
    createdAt: number;
    /** The round it shows up in. */
    round: number;
    /** Already a post in the script (the hand-written run). */
    scripted: boolean;
}

interface SimRun {
    id: number;
    kind: ScenarioKind;
    title: string;
    subject: string;
    agents: number;
    rounds: number;
    createdAt: number;
    createdByMe: boolean;
    createdByName: string;
    shared: boolean;
    sourcesUsed: ScenarioSources;
    script: Script;
    /** Live from `startedAt`, or fixed at an end state. */
    progress:
        | { kind: "live"; startedAt: number }
        | { kind: "done"; finishedAt: number }
        | {
              kind: "failed";
              finishedAt: number;
              stage: ScenarioStage;
              round: number;
              error: string;
          };
    /** Set when someone cancelled it: the elapsed time it froze at. */
    cancelled: { at: number; elapsed: number } | null;
    injections: SimInjection[];
    interviews: ScenarioInterview[];
    estimate: { calls: number; credits: number };
    draft: { text: string; networks: string[] } | null;
}

export interface ScenariosSimOptions {
    empty: boolean;
    credits: "ok" | "short" | "race";
}

const DEFAULT_OPTIONS: ScenariosSimOptions = { empty: false, credits: "ok" };

/** A file uploaded in the harness: listed at once, read `TIMING.reading` later. */
interface SimUpload {
    file: ScenarioFileOption;
    readAt: number;
}

interface Store {
    options: ScenariosSimOptions;
    runs: SimRun[];
    seq: number;
    uploads: SimUpload[];
}

let store: Store | null = null;

function estimateFor(agents: number, rounds: number): { calls: number; credits: number } {
    const calls = Math.round(agents * rounds * 0.6) + agents + 6;
    return { calls, credits: Math.ceil(calls * 0.4) };
}

function balance(options: ScenariosSimOptions): number {
    return options.credits === "short" ? 40 : 1250;
}

const NO_SOURCES: ScenarioSources = {
    documentIds: [],
    searchFiles: false,
    prospects: false,
    brandComments: false,
    companyProfile: false,
    notes: "",
};

function seed(options: ScenariosSimOptions, now: number): Store {
    if (options.empty) return { options, runs: [], seq: 10, uploads: [] };

    const priceCreated = now - 26 * HOUR;
    const price: SimRun = {
        id: 1,
        kind: "scenario",
        title: "Starter price rise in January",
        subject: PRICE_RUN_SUBJECT,
        agents: 12,
        rounds: 8,
        createdAt: priceCreated,
        createdByMe: true,
        createdByName: "Alex Morgan",
        shared: false,
        sourcesUsed: PRICE_RUN_SOURCES_USED,
        script: priceScript(),
        progress: { kind: "done", finishedAt: priceCreated + 9 * MINUTE },
        cancelled: null,
        injections: [
            {
                id: 1,
                text: PRICE_RUN_EVENT,
                createdAt: priceCreated + 4 * MINUTE,
                round: 4,
                scripted: true,
            },
        ],
        interviews: [
            {
                id: 1,
                agentId: "analyst",
                question: "Who was most likely to change their mind, and what moved them?",
                answer: "Existing customers on Starter. Tomás Reyes and Aiko Tanaka both moved from critical to neutral or supportive within a round of the event confirming the 12-month price hold. What moved them was learning the new price did not apply to them, and, for Aiko, a date for multi-entity invoicing. The freelancers who send few invoices did not move: for them the competitor's $25 plan is simply cheaper.",
                createdAt: new Date(priceCreated + 12 * MINUTE).toISOString(),
            },
            {
                id: 2,
                agentId: "a1",
                question: "What would have made you keep recommending Starter?",
                answer: "Leading with the price hold. Half my clients thought they were paying $35 from January, and I spent a day answering emails about something that didn't apply to them. For the cafés sending ten invoices a month I'd still look at the cheaper option — but I'd have been calmer about it.",
                createdAt: new Date(priceCreated + 14 * MINUTE).toISOString(),
            },
        ],
        estimate: estimateFor(12, 8),
        draft: null,
    };

    const trialSources: ScenarioSources = {
        ...NO_SOURCES,
        searchFiles: true,
        prospects: true,
        brandComments: true,
        companyProfile: true,
    };
    const trialSubject =
        "We drop the free plan in March and offer a 30-day trial of Starter instead. Free workspaces become read-only after the trial.";
    const trial: SimRun = {
        id: 2,
        kind: "scenario",
        title: "Free plan becomes a 30-day trial",
        subject: trialSubject,
        agents: 24,
        rounds: 8,
        // Two rounds in when the page loads.
        createdAt: now - (TIMING.gathering + TIMING.casting + 2 * TIMING.round + 1200),
        createdByMe: true,
        createdByName: "Alex Morgan",
        shared: true,
        sourcesUsed: trialSources,
        script: generateScript({
            seed: 2202,
            subject: trialSubject,
            agents: 24,
            rounds: 8,
            sources: sourcesFor(trialSources),
            kind: "scenario",
        }),
        progress: {
            kind: "live",
            startedAt: now - (TIMING.gathering + TIMING.casting + 2 * TIMING.round + 1200),
        },
        cancelled: null,
        injections: [],
        interviews: [],
        estimate: estimateFor(24, 8),
        draft: null,
    };

    const partnerSources: ScenarioSources = {
        ...NO_SOURCES,
        documentIds: [290, 305],
        prospects: true,
        companyProfile: true,
    };
    const partnerSubject =
        "We give accounting firms 30% off their own plan for every five clients they bring to Ledgerline.";
    const partnerCreated = now - 3 * DAY - 2 * HOUR;
    const partner: SimRun = {
        id: 5,
        kind: "scenario",
        title: "Partner discount for accounting firms",
        subject: partnerSubject,
        agents: 40,
        rounds: 10,
        createdAt: partnerCreated,
        createdByMe: false,
        createdByName: "Dana Okafor",
        shared: true,
        sourcesUsed: partnerSources,
        script: generateScript({
            seed: 5505,
            subject: partnerSubject,
            agents: 40,
            rounds: 10,
            sources: sourcesFor(partnerSources),
            kind: "scenario",
        }),
        progress: { kind: "done", finishedAt: partnerCreated + 14 * MINUTE },
        cancelled: null,
        injections: [],
        interviews: [],
        estimate: estimateFor(40, 10),
        draft: null,
    };

    const wholesaleCreated = now - 4 * DAY - 5 * HOUR;
    const wholesale: SimRun = {
        id: 3,
        kind: "scenario",
        title: "Wholesale minimum order",
        subject: "We raise the minimum wholesale order from €200 to €500.",
        agents: 30,
        rounds: 8,
        createdAt: wholesaleCreated,
        createdByMe: true,
        createdByName: "Alex Morgan",
        shared: false,
        sourcesUsed: { ...NO_SOURCES, documentIds: [263] },
        script: emptyScript(),
        progress: {
            kind: "failed",
            finishedAt: wholesaleCreated + 40_000,
            stage: "casting",
            round: 0,
            error: "None of the picked files could be read, and there was nothing else to build people from. Pick other files or paste some material, then run it again.",
        },
        cancelled: null,
        injections: [],
        interviews: [],
        estimate: estimateFor(30, 8),
        draft: null,
    };

    const supportSubject = "We move support to a four-day week: no live chat on Fridays.";
    const supportSources: ScenarioSources = { ...NO_SOURCES, searchFiles: true };
    const supportCreated = now - 6 * DAY - 3 * HOUR;
    const support: SimRun = {
        id: 4,
        kind: "scenario",
        title: "Four-day support week",
        subject: supportSubject,
        agents: 30,
        rounds: 10,
        createdAt: supportCreated,
        createdByMe: true,
        createdByName: "Alex Morgan",
        shared: false,
        sourcesUsed: supportSources,
        script: generateScript({
            seed: 4404,
            subject: supportSubject,
            agents: 30,
            rounds: 10,
            sources: sourcesFor(supportSources),
            kind: "scenario",
        }),
        progress: { kind: "live", startedAt: supportCreated },
        cancelled: {
            at: supportCreated + 20_000,
            elapsed: TIMING.gathering + TIMING.casting + 2 * TIMING.round + 2000,
        },
        injections: [],
        interviews: [],
        estimate: estimateFor(30, 10),
        draft: null,
    };

    return { options, runs: [trial, price, partner, wholesale, support], seq: 10, uploads: [] };
}

function emptyScript(): Script {
    return {
        brief: "",
        sources: [],
        people: [],
        posts: [],
        rounds: [],
        report: {
            headline: "",
            summary: "",
            dynamics: [],
            turningPoints: [],
            factions: [],
            watchFor: [],
        },
        reception: null,
    };
}

function state(now = Date.now()): Store {
    store ??= seed(DEFAULT_OPTIONS, now);
    return store;
}

/** Start over with these options. */
export function resetScenariosSim(options: Partial<ScenariosSimOptions> = {}, now = Date.now()) {
    store = seed({ ...DEFAULT_OPTIONS, ...options }, now);
}

/** Apply the harness URL's switches; a change to `empty` reseeds. */
export function configureScenariosSim(options: Partial<ScenariosSimOptions>, now = Date.now()) {
    const current = state(now);
    const next = { ...current.options, ...options };
    if (next.empty !== current.options.empty) store = seed(next, now);
    else current.options = next;
}

// ── A run at a moment ─────────────────────────────────────────────────────

interface Phase {
    status: ScenarioStatus;
    stage: ScenarioStage;
    /** Rounds finished. */
    round: number;
    /** How far through, 0–1, for usage. */
    fraction: number;
    finishedAt: number | null;
}

function phaseAt(run: SimRun, now: number): Phase {
    const { progress } = run;
    if (progress.kind === "done") {
        return {
            status: "done",
            stage: "done",
            round: run.rounds,
            fraction: 1,
            finishedAt: progress.finishedAt,
        };
    }
    if (progress.kind === "failed") {
        return {
            status: "failed",
            stage: progress.stage,
            round: progress.round,
            fraction: 0.1,
            finishedAt: progress.finishedAt,
        };
    }
    const elapsed = run.cancelled ? run.cancelled.elapsed : now - progress.startedAt;
    const phase = livePhase(run.rounds, elapsed, progress.startedAt);
    if (run.cancelled) {
        return { ...phase, status: "cancelled", finishedAt: run.cancelled.at };
    }
    return phase;
}

function livePhase(rounds: number, elapsed: number, startedAt: number): Phase {
    const total = totalMs(rounds);
    const fraction = Math.max(0, Math.min(1, elapsed / total));
    if (elapsed < TIMING.queued)
        return { status: "queued", stage: "gathering", round: 0, fraction, finishedAt: null };
    if (elapsed < TIMING.gathering)
        return { status: "running", stage: "gathering", round: 0, fraction, finishedAt: null };
    const simulating = TIMING.gathering + TIMING.casting;
    if (elapsed < simulating)
        return { status: "running", stage: "casting", round: 0, fraction, finishedAt: null };
    const round = Math.floor((elapsed - simulating) / TIMING.round);
    if (round < rounds)
        return { status: "running", stage: "simulating", round, fraction, finishedAt: null };
    if (elapsed < total)
        return {
            status: "running",
            stage: "reporting",
            round: rounds,
            fraction,
            finishedAt: null,
        };
    return {
        status: "done",
        stage: "done",
        round: rounds,
        fraction: 1,
        finishedAt: startedAt + total,
    };
}

function summaryOf(run: SimRun, phase: Phase): ScenarioSummary {
    return {
        id: run.id,
        kind: run.kind,
        title: run.title,
        subject: run.subject,
        status: phase.status,
        stage: phase.stage,
        round: phase.round,
        rounds: run.rounds,
        agents: run.agents,
        createdAt: new Date(run.createdAt).toISOString(),
        finishedAt: phase.finishedAt === null ? null : new Date(phase.finishedAt).toISOString(),
        createdByMe: run.createdByMe,
        createdByName: run.createdByName,
        shared: run.shared,
        headline: phase.status === "done" ? run.script.report.headline : null,
    };
}

/** The event an injection becomes in the feed. */
function eventPost(injection: SimInjection): ScenarioPost {
    return {
        id: `ev-${injection.id}`,
        authorId: "narrator",
        authorName: "Narrator",
        authorHandle: "narrator",
        authorKind: "narrator",
        round: injection.round,
        kind: "event",
        text: injection.text,
        root: null,
        likes: 3 + (injection.id % 4),
        dislikes: injection.id % 2,
        shares: 2 + (injection.id % 3),
        comments: [],
    };
}

function detailAt(run: SimRun, now: number): ScenarioDetail {
    const phase = phaseAt(run, now);
    const script = run.script;
    const peopleVisible =
        phase.stage === "simulating" || phase.stage === "reporting" || phase.stage === "done";
    const sourcesVisible = phase.stage !== "gathering";
    const r = phase.round;

    // Posts so far, with any events added while it ran, each in its round.
    const events = run.injections.filter(i => !i.scripted && i.round <= r).map(eventPost);
    const posts: ScenarioPost[] = [];
    if (peopleVisible) {
        for (const post of script.posts) {
            if (post.round > r) continue;
            const first = posts.length === 0 || posts[posts.length - 1]!.round !== post.round;
            if (first) posts.push(...events.filter(e => e.round === post.round));
            posts.push({ ...post, comments: post.comments.filter(c => c.round <= r) });
        }
        for (const e of events)
            if (!posts.includes(e) && !posts.some(p => p.id === e.id)) posts.push(e);
    }

    const people: ScenarioPerson[] = peopleVisible
        ? countActivity(
              script.people.map(person => {
                  const history = person.stanceHistory.slice(0, r + 1);
                  return {
                      ...person,
                      stanceHistory: history,
                      stance: history[history.length - 1]!,
                      lastThought: r >= 1 ? person.lastThought : null,
                  };
              }),
              posts
          )
        : [];

    const done = phase.status === "done";
    const summary = summaryOf(run, phase);
    // Like the server: events close when the final round starts.
    const going = phase.status === "queued" || phase.status === "running";
    const eventsOpen =
        going &&
        (phase.stage === "gathering" ||
            phase.stage === "casting" ||
            (phase.stage === "simulating" && r < summary.rounds - 1));
    return {
        ...summary,
        brief: sourcesVisible && script.brief ? script.brief : null,
        sourcesUsed: run.sourcesUsed,
        sources: sourcesVisible ? script.sources : [],
        people,
        posts,
        roundStats: peopleVisible ? roundStats(people, posts, r) : [],
        report: done ? script.report : null,
        reception: done ? script.reception : null,
        injections: run.injections.map(i => ({
            id: i.id,
            text: i.text,
            round:
                i.round <= r && phase.stage !== "gathering" && phase.stage !== "casting"
                    ? i.round
                    : null,
            createdAt: new Date(i.createdAt).toISOString(),
        })),
        eventsOpen,
        error: run.progress.kind === "failed" ? run.progress.error : null,
        estimate: run.estimate,
        usage: {
            calls: Math.round(run.estimate.calls * phase.fraction),
            credits: Math.round(run.estimate.credits * phase.fraction),
        },
        canManage: run.createdByMe,
        draft: run.draft,
    };
}

// ── Post tests opened from Brand ──────────────────────────────────────────

const SAMPLE_DRAFT =
    "Bank feeds are back, and faster: transactions now arrive within minutes instead of overnight. Turn it on in Settings › Banking.";

/** A Brand post test opened by its id: the harness makes one up, finished. */
function postTestRun(id: number, now: number): SimRun {
    const { agents, rounds } = SCENARIO_LIMITS.postTest;
    const created = now - 20 * MINUTE;
    return {
        id,
        kind: "post_test",
        title: "Post test",
        subject: SAMPLE_DRAFT,
        agents,
        rounds,
        createdAt: created,
        createdByMe: true,
        createdByName: "Alex Morgan",
        shared: false,
        sourcesUsed: { ...NO_SOURCES, brandComments: true, companyProfile: true },
        script: generateScript({
            seed: id,
            subject: SAMPLE_DRAFT,
            agents,
            rounds,
            sources: sourcesFor({ ...NO_SOURCES, brandComments: true, companyProfile: true }),
            kind: "post_test",
            draft: { text: SAMPLE_DRAFT, networks: ["linkedin"] },
        }),
        progress: { kind: "done", finishedAt: created + 2 * MINUTE },
        cancelled: null,
        injections: [],
        interviews: [],
        estimate: estimateFor(agents, rounds),
        draft: { text: SAMPLE_DRAFT, networks: ["linkedin"] },
    };
}

// ── Interviews ────────────────────────────────────────────────────────────

function answerFor(run: SimRun, detail: ScenarioDetail, agentId: string, question: string): string {
    if (agentId === "analyst") {
        const moved = [...detail.people]
            .sort((a, b) => Math.abs(b.stance - b.startStance) - Math.abs(a.stance - a.startStance))
            .slice(0, 2)
            .map(p => p.name);
        const meanNow = detail.roundStats[detail.roundStats.length - 1]?.meanStance ?? 0;
        if (detail.report) {
            return `${detail.report.headline} ${detail.report.dynamics[0]?.text ?? ""} The people whose minds changed most were ${moved.join(" and ")}. Keep in mind these are simulated people built from your records — read it as one way it could go.`;
        }
        return `After round ${detail.round} of ${run.rounds}, the mood is ${moodWords(meanNow)} (${meanNow.toFixed(1)} on a scale from −2 to +2). ${moved.length ? `${moved.join(" and ")} have moved the most so far.` : ""} Ask again when the run is done for the whole picture.`;
    }
    const person = detail.people.find(p => p.id === agentId)!;
    const lead =
        person.stance > 0
            ? "I'm comfortable with it."
            : person.stance < 0
              ? "I'm not happy about it, and I said so."
              : "Honestly, I haven't made up my mind.";
    const why = /why|what would|what made/i.test(question)
        ? ` As a ${person.role.charAt(0).toLowerCase()}${person.role.slice(1)}, what matters to me is ${person.interests.slice(0, 2).join(" and ")}.`
        : "";
    return `${lead}${why} ${person.lastThought ?? "I'm still reading what everyone else is saying."}`;
}

// ── HTTP ──────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

const err = (status: number, error: string, extra: Record<string, unknown> = {}) =>
    json({ error, ...extra }, status);

function readBody(init?: RequestInit): Record<string, unknown> {
    if (!init?.body || typeof init.body !== "string") return {};
    try {
        const parsed: unknown = JSON.parse(init.body);
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const int = (value: unknown): number => (typeof value === "number" ? Math.round(value) : NaN);

function readSources(value: unknown): ScenarioSources {
    const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    return {
        documentIds: Array.isArray(v.documentIds)
            ? v.documentIds.filter((x): x is number => typeof x === "number")
            : [],
        searchFiles: v.searchFiles === true,
        prospects: v.prospects === true,
        brandComments: v.brandComments === true,
        companyProfile: v.companyProfile === true,
        notes: str(v.notes),
    };
}

/** The form's files at `now`: uploads first, each read once its time has come. */
function filesAt(S: Store, now: number): ScenarioFileOption[] {
    const uploaded = S.uploads.map(({ file, readAt }) => ({
        ...file,
        status:
            now < readAt
                ? ("processing" as const)
                : /unreadable/i.test(file.title)
                  ? ("failed" as const)
                  : ("ready" as const),
    }));
    return [...uploaded.reverse(), ...SOURCE_OPTIONS.documents];
}

/**
 * The two upload calls the form makes (`/api/upload-local`, then
 * `/api/uploadDocument`), answered in memory: the file is listed at once as
 * being read, and read `TIMING.reading` later. A name with "unreadable" in it
 * fails to be read. Null for anything else.
 */
export async function simulateUpload(
    url: URL,
    init?: RequestInit,
    now = Date.now()
): Promise<Response | null> {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "POST") return null;
    const S = state(now);
    if (url.pathname === "/api/upload-local") {
        const form = init?.body instanceof FormData ? init.body : null;
        const blob = form?.get("file");
        if (!(blob instanceof Blob)) return err(400, "No file");
        return json({ url: `/api/files/sim-${S.uploads.length + 1}`, provider: "database" });
    }
    if (url.pathname === "/api/uploadDocument") {
        const body = readBody(init);
        const title = str(body.documentName) || "Untitled";
        const folder = str(body.category) || null;
        const id = 900 + S.uploads.length;
        S.uploads.push({
            file: {
                id,
                title,
                folder,
                mimeType: str(body.mimeType) || null,
                addedAt: new Date(now).toISOString(),
                status: "processing",
                aboutCompany: false,
            },
            readAt: now + TIMING.reading,
        });
        return json(
            {
                success: true,
                jobId: `sim-job-${id}`,
                message: "Document processing started",
                document: { id, title, url: str(body.documentUrl), category: folder ?? "" },
            },
            202
        );
    }
    return null;
}

/** Answers `/api/scenarios/**`; null for anything else. */
export async function simulateScenarios(
    url: URL,
    init?: RequestInit,
    now = Date.now()
): Promise<Response | null> {
    if (!url.pathname.startsWith("/api/scenarios")) return null;
    const S = state(now);
    const method = (init?.method ?? "GET").toUpperCase();
    const parts = url.pathname
        .replace(/^\/api\/scenarios\/?/, "")
        .split("/")
        .filter(Boolean);
    const [head, action] = parts;

    if (!head) {
        if (method === "GET") {
            const runs = S.runs
                .filter(r => r.kind === "scenario" && (r.createdByMe || r.shared))
                .sort((a, b) => b.createdAt - a.createdAt)
                .map(r => summaryOf(r, phaseAt(r, now)));
            return json({ runs });
        }
        if (method === "POST") return create(S, readBody(init), now);
        return err(405, "Method not allowed");
    }

    if (head === "sources" && method === "GET")
        return json({ ...SOURCE_OPTIONS, documents: filesAt(S, now) });

    if (head === "estimate" && method === "POST") {
        const body = readBody(init);
        const agents = int(body.agents);
        const rounds = int(body.rounds);
        const { agents: A, rounds: R } = SCENARIO_LIMITS;
        if (!(agents >= A.min && agents <= A.max) || !(rounds >= R.min && rounds <= R.max))
            return err(400, `Pick ${A.min}–${A.max} people and ${R.min}–${R.max} rounds.`);
        const estimate = estimateFor(agents, rounds);
        const have = balance(S.options);
        return json({
            agents,
            rounds,
            ...estimate,
            balance: have,
            enough: estimate.credits <= have,
        });
    }

    const id = Number(head);
    if (!Number.isInteger(id)) return err(404, "Not found");
    let run = S.runs.find(r => r.id === id);
    if (!run && id >= 500) {
        run = postTestRun(id, now);
        S.runs.push(run);
    }
    if (!run || (!run.createdByMe && !run.shared))
        return err(404, "This scenario is not here any more.");
    const mine = run.createdByMe;
    const onlyCreator = () => err(403, "Only the person who started this scenario can change it.");

    if (!action) {
        if (method === "GET") return json({ run: detailAt(run, now) });
        if (method === "PATCH") {
            if (!mine) return onlyCreator();
            const body = readBody(init);
            if (body.title !== undefined) {
                const title = str(body.title).trim();
                if (!title) return err(400, "Give it a title.");
                if (title.length > 120) return err(400, "Keep the title under 120 characters.");
                run.title = title;
            }
            if (typeof body.shared === "boolean") run.shared = body.shared;
            return json({ run: summaryOf(run, phaseAt(run, now)) });
        }
        if (method === "DELETE") {
            if (!mine) return onlyCreator();
            S.runs = S.runs.filter(r => r.id !== id);
            return json({ ok: true });
        }
        return err(405, "Method not allowed");
    }

    if (action === "cancel" && method === "POST") {
        if (!mine) return onlyCreator();
        const phase = phaseAt(run, now);
        if (phase.status !== "queued" && phase.status !== "running")
            return err(409, "This scenario has already stopped.");
        if (run.progress.kind === "live") {
            run.cancelled = { at: now, elapsed: now - run.progress.startedAt };
        }
        return json({ run: summaryOf(run, phaseAt(run, now)) });
    }

    if (action === "events" && method === "POST") {
        if (!mine) return onlyCreator();
        const phase = phaseAt(run, now);
        if (phase.status !== "running" && phase.status !== "queued")
            return err(409, "Events can only be added while the scenario is running.");
        if (phase.round >= run.rounds)
            return err(409, "The last round has finished; the report is being written.");
        const text = str(readBody(init).text).trim();
        if (!text) return err(400, "Describe what happens.");
        if (text.length > SCENARIO_LIMITS.eventMax)
            return err(400, `Keep it under ${SCENARIO_LIMITS.eventMax} characters.`);
        const injection: SimInjection = {
            id: S.seq++,
            text,
            createdAt: now,
            round: phase.round + 1,
            scripted: false,
        };
        run.injections.push(injection);
        return json(
            {
                injection: {
                    id: injection.id,
                    text,
                    round: null,
                    createdAt: new Date(now).toISOString(),
                },
            },
            201
        );
    }

    if (action === "interviews") {
        if (method === "GET") return json({ interviews: run.interviews });
        if (method === "POST") {
            const body = readBody(init);
            const agentId = str(body.agentId);
            const question = str(body.question).trim();
            const detail = detailAt(run, now);
            if (detail.round < 1)
                return err(409, "People can answer once the first round has finished.");
            if (!question) return err(400, "Ask a question first.");
            if (question.length > SCENARIO_LIMITS.questionMax)
                return err(
                    400,
                    `Keep the question under ${SCENARIO_LIMITS.questionMax} characters.`
                );
            if (agentId !== "analyst" && !detail.people.some(p => p.id === agentId))
                return err(404, "That person is not in this scenario.");
            const interview: ScenarioInterview = {
                id: S.seq++,
                agentId,
                question,
                answer: answerFor(run, detail, agentId, question),
                createdAt: new Date(now).toISOString(),
            };
            run.interviews.push(interview);
            return json({ interview }, 201);
        }
    }

    return err(405, "Method not allowed");
}

function create(S: Store, body: Record<string, unknown>, now: number): Response {
    const subject = str(body.subject).trim();
    const title = str(body.title).trim();
    const agents = int(body.agents);
    const rounds = int(body.rounds);
    const sources = readSources(body.sources);
    const L = SCENARIO_LIMITS;
    if (!subject) return err(400, "Say what happens: the situation people react to.");
    if (subject.length > L.subjectMax)
        return err(400, `Keep the situation under ${L.subjectMax} characters.`);
    if (!(agents >= L.agents.min && agents <= L.agents.max))
        return err(400, `Pick between ${L.agents.min} and ${L.agents.max} people.`);
    if (!(rounds >= L.rounds.min && rounds <= L.rounds.max))
        return err(400, `Pick between ${L.rounds.min} and ${L.rounds.max} rounds.`);
    if (sources.documentIds.length > L.documentsMax)
        return err(400, `Pick ${L.documentsMax} files at most.`);
    if (sources.notes.length > L.notesMax)
        return err(400, `Pasted material can be ${L.notesMax} characters at most.`);
    const estimate = estimateFor(agents, rounds);
    const have = balance(S.options);
    if (S.options.credits === "race" || estimate.credits > have) {
        return err(
            402,
            S.options.credits === "race"
                ? "The workspace's balance changed since the estimate: this scenario needs about " +
                      `${estimate.credits} credits and there are 30 left.`
                : `This scenario needs about ${estimate.credits} credits and the workspace has ${have}.`,
            { code: "insufficient_credits" }
        );
    }
    const id = S.seq++;
    const run: SimRun = {
        id,
        kind: "scenario",
        title: title || (subject.length > 60 ? `${subject.slice(0, 58).trimEnd()}…` : subject),
        subject,
        agents,
        rounds,
        createdAt: now,
        createdByMe: true,
        createdByName: "Alex Morgan",
        shared: false,
        sourcesUsed: sources,
        script: generateScript({
            seed: 7000 + id,
            subject,
            agents,
            rounds,
            sources: sourcesFor(sources, filesAt(S, now)),
            kind: "scenario",
        }),
        progress: { kind: "live", startedAt: now },
        cancelled: null,
        injections: [],
        interviews: [],
        estimate,
        draft: null,
    };
    S.runs.push(run);
    return json({ run: summaryOf(run, phaseAt(run, now)) }, 201);
}
