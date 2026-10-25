/**
 * In-memory `/api/brand/post-tests/**` for the Growth harness, and the
 * `postTestId` link `POST /api/brand/posts` makes. Shapes are the Scenarios
 * wire contract's (`~/lib/scenarios/types`).
 *
 * A test walks through the stages one poll at a time and is done after
 * seven; its readers, comments and numbers come from the Scenarios
 * harness's generator, seeded by the draft, so the same text tests the same
 * way. The track record starts with seven tested posts, six with real
 * numbers (enough to show agreement); `fewTests` starts with three, two with
 * numbers ("not enough yet"). `broke` answers a new test with 402.
 */
import {
    SCENARIO_LIMITS,
    normalizeDraft,
    type PostTestLink,
    type PostTestResult,
    type ScenarioStage,
    type ScenarioStatus,
    type TrackRecord,
    type TrackRecordRow,
} from "~/lib/scenarios/types";

import { generateScript, hashText, sourcesFor, type Script } from "../scenarios/world";

const DAY = 24 * 60 * 60_000;

export interface PostTestSimOptions {
    fewTests: boolean;
    broke: boolean;
}

interface SimTest {
    runId: number;
    text: string;
    networks: string[];
    polls: number;
    script: Script | null;
    linked: boolean;
}

interface Store {
    options: PostTestSimOptions;
    tests: Map<number, SimTest>;
    rows: TrackRecordRow[];
    tested: number;
    seq: number;
}

const MINIMUM = 5;

function seedRows(now: number, few: boolean): TrackRecordRow[] {
    const at = (days: number) => new Date(now - days * DAY).toISOString();
    const all: TrackRecordRow[] = [
        {
            runId: 401,
            postId: "p-seed-1",
            network: "linkedin",
            publishedAt: at(12),
            text: "Bank feeds are back, and faster: transactions now arrive within minutes instead of overnight.",
            predicted: 0.41,
            actual: 0.062,
        },
        {
            runId: 402,
            postId: "p-seed-2",
            network: "linkedin",
            publishedAt: at(10),
            text: "We're hiring a support lead in Lisbon. Small team, real customers, no ticket quotas.",
            predicted: 0.22,
            actual: 0.031,
        },
        {
            runId: 403,
            postId: "p-seed-3",
            network: "linkedin",
            publishedAt: at(8),
            text: "Three things we learned moving 2,000 workspaces to the new ledger.",
            predicted: 0.36,
            actual: 0.054,
        },
        {
            runId: 404,
            postId: "p-seed-4",
            network: "bluesky",
            publishedAt: at(7),
            text: "New: export your invoices to CSV in one click.",
            predicted: 0.18,
            actual: 0.024,
        },
        {
            runId: 405,
            postId: "p-seed-5",
            network: "bluesky",
            publishedAt: at(5),
            text: "Office hours this Thursday: bring your bookkeeping questions.",
            predicted: 0.27,
            actual: 0.019,
        },
        {
            runId: 406,
            postId: "p-seed-6",
            network: "linkedin",
            publishedAt: at(4),
            text: "Our pricing page, rewritten in plain words. Tell us what's still unclear.",
            predicted: 0.3,
            actual: 0.047,
        },
        {
            runId: 407,
            postId: "p-seed-7",
            network: "linkedin",
            publishedAt: at(1),
            text: "Multi-entity invoicing is coming this spring. Here's what it does.",
            predicted: 0.44,
            actual: null,
        },
    ];
    return few ? [all[0]!, all[1]!, all[6]!] : all;
}

function seed(options: PostTestSimOptions, now: number): Store {
    const rows = seedRows(now, options.fewTests);
    return { options, tests: new Map(), rows, tested: rows.length, seq: 500 };
}

let store: Store = seed({ fewTests: false, broke: false }, Date.now());

export function resetPostTests(options: Partial<PostTestSimOptions> = {}, now = Date.now()) {
    store = seed({ fewTests: false, broke: false, ...options }, now);
}

/** A change to `fewTests` reseeds the track record; `broke` just flips. */
export function configurePostTests(options: Partial<PostTestSimOptions>, now = Date.now()) {
    const next = { ...store.options, ...options };
    if (next.fewTests !== store.options.fewTests) store = seed(next, now);
    else store.options = next;
}

// ── Ranking ───────────────────────────────────────────────────────────────

function ranks(values: number[]): number[] {
    const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const out = new Array<number>(values.length);
    for (let k = 0; k < order.length; ) {
        let j = k;
        while (j + 1 < order.length && order[j + 1]!.v === order[k]!.v) j++;
        const rank = (k + j) / 2 + 1;
        for (let m = k; m <= j; m++) out[order[m]!.i] = rank;
        k = j + 1;
    }
    return out;
}

/** Spearman's rho: the Pearson correlation of the ranks. */
export function spearman(xs: number[], ys: number[]): number {
    const rx = ranks(xs);
    const ry = ranks(ys);
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const mx = mean(rx);
    const my = mean(ry);
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < rx.length; i++) {
        num += (rx[i]! - mx) * (ry[i]! - my);
        dx += (rx[i]! - mx) ** 2;
        dy += (ry[i]! - my) ** 2;
    }
    return dx === 0 || dy === 0 ? 0 : num / Math.sqrt(dx * dy);
}

function median(values: number[]): number {
    const s = [...values].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function trackRecord(): TrackRecord {
    const withActual = store.rows.filter(r => r.actual !== null);
    const enough = withActual.length >= MINIMUM;
    const predicted = withActual.map(r => r.predicted);
    const actual = withActual.map(r => r.actual!);
    const mp = enough ? median(predicted) : 0;
    const ma = enough ? median(actual) : 0;
    const hits = enough ? withActual.filter(r => r.predicted > mp === r.actual! > ma).length : 0;
    return {
        tested: store.tested,
        withResults: withActual.length,
        minimum: MINIMUM,
        spearman: enough ? Math.round(spearman(predicted, actual) * 100) / 100 : null,
        hits,
        total: enough ? withActual.length : 0,
        rows: [...store.rows].sort(
            (a, b) =>
                new Date(b.publishedAt ?? 0).getTime() - new Date(a.publishedAt ?? 0).getTime()
        ),
    };
}

// ── A test, one poll at a time ────────────────────────────────────────────

const STEPS: Array<{ status: ScenarioStatus; stage: ScenarioStage; round: number }> = [
    { status: "queued", stage: "gathering", round: 0 },
    { status: "running", stage: "gathering", round: 0 },
    { status: "running", stage: "casting", round: 0 },
    { status: "running", stage: "simulating", round: 0 },
    { status: "running", stage: "simulating", round: 1 },
    { status: "running", stage: "simulating", round: 2 },
    { status: "running", stage: "reporting", round: 3 },
    { status: "done", stage: "done", round: 3 },
];

function scriptFor(test: SimTest): Script {
    const { agents, rounds } = SCENARIO_LIMITS.postTest;
    test.script ??= generateScript({
        seed: hashText(normalizeDraft(test.text)),
        subject: test.text,
        agents,
        rounds,
        sources: sourcesFor({
            documentIds: [],
            searchFiles: false,
            prospects: false,
            brandComments: true,
            companyProfile: true,
            notes: "",
        }),
        kind: "post_test",
        draft: { text: test.text, networks: test.networks },
    });
    return test.script;
}

function resultOf(test: SimTest): PostTestResult {
    const step = STEPS[Math.min(test.polls, STEPS.length - 1)]!;
    const done = step.status === "done";
    const script = done ? scriptFor(test) : null;
    const seedPost = script?.posts.find(p => p.kind === "seed");
    const people = new Map((script?.people ?? []).map(p => [p.id, p]));
    return {
        runId: test.runId,
        status: step.status,
        stage: step.stage,
        round: step.round,
        rounds: SCENARIO_LIMITS.postTest.rounds,
        text: test.text,
        reception: script?.reception ?? null,
        headline: script?.report.headline ?? null,
        // One comment per reader, with where they stood when they wrote it.
        sampleComments: (seedPost?.comments ?? [])
            .filter((c, i, all) => all.findIndex(x => x.authorId === c.authorId) === i)
            .slice(0, 5)
            .map(c => {
                const who = people.get(c.authorId);
                return {
                    name: c.authorName,
                    handle: c.authorHandle,
                    role: who?.role ?? "Reader",
                    text: c.text,
                    stance: who?.stanceHistory[c.round] ?? who?.stance ?? 0,
                };
            }),
        error: null,
    };
}

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

/**
 * Answers `/api/brand/post-tests/**`. `canPublish` is the harness's Viewer
 * switch: starting a test needs social.publish, as posting does.
 */
export function simulatePostTests(
    u: URL,
    init: RequestInit | undefined,
    canPublish: boolean
): Response {
    const method = (init?.method ?? "GET").toUpperCase();
    const rest = u.pathname.replace(/^\/api\/brand\/post-tests\/?/, "");

    if (!rest && method === "POST") {
        if (!canPublish)
            return json(
                { error: "Your role can read Brand but not test or post as the company." },
                403
            );
        if (store.options.broke)
            return json(
                {
                    error: "Testing a post needs about 30 credits and the workspace has 12.",
                    code: "insufficient_credits",
                },
                402
            );
        let body: Record<string, unknown> = {};
        try {
            body =
                typeof init?.body === "string"
                    ? (JSON.parse(init.body) as Record<string, unknown>)
                    : {};
        } catch {
            body = {};
        }
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text) return json({ error: "Write the post first." }, 400);
        const networks = Array.isArray(body.networks)
            ? body.networks.filter((n): n is string => typeof n === "string")
            : [];
        const test: SimTest = {
            runId: store.seq++,
            text,
            networks,
            polls: 0,
            script: null,
            linked: false,
        };
        store.tests.set(test.runId, test);
        return json({ test: resultOf(test) }, 201);
    }

    if (rest === "track-record" && method === "GET") return json({ record: trackRecord() });

    const runId = Number(rest);
    if (method === "GET" && Number.isInteger(runId)) {
        const test = store.tests.get(runId);
        if (!test) return json({ error: "That post test is not here any more." }, 404);
        test.polls++;
        return json({ test: resultOf(test) });
    }
    return json({ error: "Method not allowed" }, 405);
}

/**
 * What `POST /api/brand/posts` does with a `postTestId`: a finished test of
 * the same text is linked to the first post it made and joins the track
 * record (waiting for impressions); an edited draft is reported stale.
 */
export function linkPostTest(
    postTestId: unknown,
    body: string,
    created: Array<{ id: string; platform: string; publishedAt: string | null }>
): PostTestLink | undefined {
    if (typeof postTestId !== "number") return undefined;
    const test = store.tests.get(postTestId);
    if (!test) return { runId: postTestId, linked: false, stale: false };
    const result = resultOf(test);
    if (result.status !== "done" || !result.reception)
        return { runId: postTestId, linked: false, stale: false };
    if (normalizeDraft(test.text) !== normalizeDraft(body))
        return { runId: postTestId, linked: false, stale: true };
    const first = created[0];
    if (first && !test.linked) {
        test.linked = true;
        store.tested++;
        store.rows.push({
            runId: test.runId,
            postId: first.id,
            network: first.platform,
            publishedAt: first.publishedAt,
            text: test.text,
            predicted: result.reception.engagementRate,
            actual: null,
        });
    }
    return { runId: postTestId, linked: true, stale: false };
}
