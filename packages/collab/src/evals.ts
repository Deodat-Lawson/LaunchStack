/**
 * Meeting quality evaluation.
 *
 * Scores a *finished* meeting on properties that can be checked against the
 * transcript itself, with no second model in the loop. That constraint is
 * deliberate: an LLM judge scoring an LLM conversation gives a number that
 * moves when the judge changes, and these metrics have to be stable enough to
 * gate a release.
 *
 * Each dimension answers a question a person would ask after reading the
 * minutes:
 *
 * - **coverage**      Did they actually work the agenda?
 * - **participation** Did everyone contribute, or did one voice run the room?
 * - **responsiveness**When someone was addressed, did they answer?
 * - **decisions**     Did anything get decided and owned?
 * - **grounding**     Are the specifics traceable to the supplied context?
 * - **redundancy**    Did they repeat themselves to fill turns?
 * - **termination**   Did it end because the work was done, or because it hit the cap?
 * - **handoff**       Was human control actually respected?
 */

import { buildMinutes } from "./minutes";
import type { ChannelMessage, MeetingConfig, MeetingState } from "./types";

export interface MeetingEvalDimension {
    id: string;
    label: string;
    /** 0–1. */
    score: number;
    /** Relative importance when combining into the overall score. */
    weight: number;
    detail: string;
}

export interface MeetingEvalResult {
    meetingId: string;
    title: string;
    /** Weighted mean of the dimensions, 0–1. */
    overall: number;
    dimensions: MeetingEvalDimension[];
    passed: boolean;
    /** Dimensions that scored below their individual floor. */
    failures: string[];
}

export interface MeetingEvalThresholds {
    /** Overall score a meeting must reach to pass. */
    overall: number;
    /** Per-dimension floors. A dimension absent here has no floor. */
    perDimension?: Record<string, number>;
}

export const DEFAULT_MEETING_THRESHOLDS: MeetingEvalThresholds = {
    overall: 0.7,
    perDimension: {
        // A meeting that ignored the agenda or let one agent monologue is a
        // failure regardless of how well it scores elsewhere.
        coverage: 0.5,
        participation: 0.5,
        handoff: 1,
    },
};

const STOPWORDS = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "of",
    "to",
    "in",
    "on",
    "for",
    "with",
    "we",
    "i",
    "you",
    "it",
    "is",
    "are",
    "be",
    "this",
    "that",
    "our",
    "your",
    "at",
    "as",
    "by",
    "from",
    "if",
    "so",
    "not",
    "can",
    "will",
    "would",
    "should",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "was",
    "were",
    "been",
    "they",
]);

function tokens(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function overlap(a: Set<string>, b: Set<string>): number {
    if (a.size === 0) return 0;
    let hits = 0;
    for (const word of a) if (b.has(word)) hits++;
    return hits / a.size;
}

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

/** Agenda items (and the objective) that the conversation actually touched. */
function scoreCoverage(config: MeetingConfig, chat: ChannelMessage[]): MeetingEvalDimension {
    const spoken = new Set(tokens(chat.map(m => m.text).join(" ")));
    const targets = config.agenda.length > 0 ? config.agenda : [config.objective];

    const covered = targets.filter(item => overlap(new Set(tokens(item)), spoken) >= 0.5);
    const score = targets.length === 0 ? 1 : covered.length / targets.length;

    return {
        id: "coverage",
        label: "Agenda coverage",
        score,
        weight: 2,
        detail: `${covered.length}/${targets.length} ${config.agenda.length > 0 ? "agenda items" : "objectives"} discussed`,
    };
}

/**
 * Airtime spread, as 1 − normalized Gini. A single speaker scores 0; perfectly
 * even participation scores 1.
 */
function scoreParticipation(config: MeetingConfig, chat: ChannelMessage[]): MeetingEvalDimension {
    const counts = config.participants.map(
        p => chat.filter(m => (m.author.onBehalfOfPersonaId ?? m.author.id) === p.id).length
    );
    const total = counts.reduce((a, b) => a + b, 0);
    const n = counts.length;

    if (n <= 1 || total === 0) {
        return {
            id: "participation",
            label: "Participation balance",
            score: total === 0 ? 0 : 1,
            weight: 1.5,
            detail: total === 0 ? "nobody spoke" : "single participant",
        };
    }

    const sorted = [...counts].sort((a, b) => a - b);
    const weighted = sorted.reduce((sum, value, index) => sum + (index + 1) * value, 0);
    const gini = (2 * weighted) / (n * total) - (n + 1) / n;
    // Raw Gini tops out at (n-1)/n, so a two-person monologue would otherwise
    // score 0.5 rather than 0. Normalize against that ceiling.
    const worstCase = (n - 1) / n;
    const silent = counts.filter(c => c === 0).length;

    return {
        id: "participation",
        label: "Participation balance",
        score: Math.max(0, Math.min(1, 1 - gini / worstCase)),
        weight: 1.5,
        detail: `${counts.join("/")} turns${silent > 0 ? `, ${silent} never spoke` : ""}`,
    };
}

/**
 * Whether the floor actually moved to whoever was addressed by name.
 *
 * The check is deliberately strict — the *next* speaker, not "spoke again at
 * some point" — because a looser window is satisfied by any rotation policy
 * and therefore measures nothing. Mentions in the final message are ignored:
 * nobody could have answered them.
 */
function scoreResponsiveness(config: MeetingConfig, chat: ChannelMessage[]): MeetingEvalDimension {
    const ids = new Set(config.participants.map(p => p.id));
    let addressed = 0;
    let answered = 0;

    for (let i = 0; i < chat.length - 1; i++) {
        const message = chat[i]!;
        const speaker = message.author.onBehalfOfPersonaId ?? message.author.id;
        const mentions = [...message.text.matchAll(/@([a-zA-Z0-9_-]+)/g)]
            .map(m => m[1]!)
            .filter(id => ids.has(id) && id !== speaker);
        if (mentions.length === 0) continue;

        addressed++;
        const next = chat[i + 1]!;
        if (mentions.includes(next.author.onBehalfOfPersonaId ?? next.author.id)) {
            answered++;
        }
    }

    return {
        id: "responsiveness",
        label: "Addressed and answered",
        // No one was addressed: nothing was dropped, but nothing was directed
        // either. Neutral rather than perfect.
        score: addressed === 0 ? 0.6 : answered / addressed,
        weight: 1,
        detail: addressed === 0 ? "no direct requests made" : `${answered}/${addressed} answered`,
    };
}

/** Did the meeting produce a decision and an owned action? */
function scoreDecisions(
    config: MeetingConfig,
    state: MeetingState,
    transcript: ChannelMessage[]
): MeetingEvalDimension {
    const minutes = buildMinutes(config, state, transcript);
    const hasDecision = minutes.decisions.length > 0;
    const hasAction = minutes.actionItems.length > 0;
    const hasOwner = minutes.actionItems.some(a => a.owner);

    const score = (hasDecision ? 0.5 : 0) + (hasAction ? 0.3 : 0) + (hasOwner ? 0.2 : 0);
    return {
        id: "decisions",
        label: "Decisions and owners",
        score,
        weight: 2,
        detail: `${minutes.decisions.length} decision(s), ${minutes.actionItems.length} action item(s), ${
            hasOwner ? "owned" : "unowned"
        }`,
    };
}

/**
 * Specific claims — numbers and proper nouns — that appear in the supplied
 * context. Only meaningful when the meeting was given context; without it
 * there is nothing to be grounded in and the dimension abstains.
 */
function scoreGrounding(config: MeetingConfig, chat: ChannelMessage[]): MeetingEvalDimension {
    const context = config.context ?? [];
    if (context.length === 0) {
        return {
            id: "grounding",
            label: "Grounding in context",
            score: 1,
            weight: 0,
            detail: "no context supplied — dimension not applicable",
        };
    }

    const haystack = context.join(" ").toLowerCase();
    const claims = new Set<string>();
    for (const message of chat) {
        for (const match of message.text.matchAll(/\b\d+(?:[.,]\d+)?%?\b/g)) claims.add(match[0]);
    }

    if (claims.size === 0) {
        return {
            id: "grounding",
            label: "Grounding in context",
            score: 0.5,
            weight: 1.5,
            detail: "no specific figures cited",
        };
    }

    const supported = [...claims].filter(claim => haystack.includes(claim.toLowerCase()));
    return {
        id: "grounding",
        label: "Grounding in context",
        score: supported.length / claims.size,
        weight: 1.5,
        detail: `${supported.length}/${claims.size} figures traceable to the supplied context`,
    };
}

/** Penalizes turns that mostly restate an earlier turn. */
function scoreRedundancy(chat: ChannelMessage[]): MeetingEvalDimension {
    if (chat.length < 2) {
        return {
            id: "redundancy",
            label: "Non-repetition",
            score: 1,
            weight: 1,
            detail: "too short to repeat",
        };
    }

    const sets = chat.map(m => new Set(tokens(m.text)));
    let repeats = 0;
    for (let i = 1; i < sets.length; i++) {
        const current = sets[i]!;
        if (current.size === 0) continue;
        const worst = Math.max(...sets.slice(0, i).map(prev => overlap(current, prev)));
        if (worst > 0.7) repeats++;
    }

    return {
        id: "redundancy",
        label: "Non-repetition",
        score: 1 - repeats / (chat.length - 1),
        weight: 1,
        detail: repeats === 0 ? "no near-duplicate turns" : `${repeats} near-duplicate turn(s)`,
    };
}

/** Ending on the completion marker beats running out of turns. */
function scoreTermination(config: MeetingConfig, state: MeetingState): MeetingEvalDimension {
    if (state.status === "failed") {
        return {
            id: "termination",
            label: "Clean ending",
            score: 0,
            weight: 1.5,
            detail: state.error ?? "failed",
        };
    }
    if (state.status !== "completed") {
        return {
            id: "termination",
            label: "Clean ending",
            score: 0.3,
            weight: 1.5,
            detail: `still ${state.status}`,
        };
    }
    const hitCap = state.turnIndex >= config.maxTurns;
    return {
        id: "termination",
        label: "Clean ending",
        score: hitCap ? 0.4 : 1,
        weight: 1.5,
        detail: hitCap
            ? `ran to the ${config.maxTurns}-turn cap`
            : `closed after ${state.turnIndex} turns`,
    };
}

/**
 * Human control has to actually hold. Any agent turn between a takeover and
 * the matching release is a correctness bug, not a quality shortfall — hence
 * the all-or-nothing score and the floor in the default thresholds.
 */
function scoreHandoff(transcript: ChannelMessage[]): MeetingEvalDimension {
    let underHumanControl = false;
    let violations = 0;
    let takeovers = 0;

    for (const message of transcript) {
        if (message.kind === "system") {
            if (/took (the floor|over)/i.test(message.text)) {
                underHumanControl = true;
                takeovers++;
            } else if (/handed control back|resumed/i.test(message.text)) {
                underHumanControl = false;
            }
            continue;
        }
        if (
            underHumanControl &&
            message.author.kind === "agent" &&
            message.author.id !== "system"
        ) {
            violations++;
        }
    }

    return {
        id: "handoff",
        label: "Human control respected",
        score: violations === 0 ? 1 : 0,
        weight: 2,
        detail:
            takeovers === 0
                ? "no takeover occurred"
                : violations === 0
                  ? `${takeovers} takeover(s), no agent spoke over the human`
                  : `${violations} agent turn(s) during human control`,
    };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function evaluateMeeting(
    config: MeetingConfig,
    state: MeetingState,
    transcript: ChannelMessage[],
    thresholds: MeetingEvalThresholds = DEFAULT_MEETING_THRESHOLDS
): MeetingEvalResult {
    const chat = transcript.filter(m => m.kind === "chat");

    const dimensions = [
        scoreCoverage(config, chat),
        scoreParticipation(config, chat),
        scoreResponsiveness(config, chat),
        scoreDecisions(config, state, transcript),
        scoreGrounding(config, chat),
        scoreRedundancy(chat),
        scoreTermination(config, state),
        scoreHandoff(transcript),
    ];

    const weightTotal = dimensions.reduce((sum, d) => sum + d.weight, 0);
    const overall =
        weightTotal === 0
            ? 0
            : dimensions.reduce((sum, d) => sum + d.score * d.weight, 0) / weightTotal;

    const failures = dimensions
        .filter(d => {
            const floor = thresholds.perDimension?.[d.id];
            return floor !== undefined && d.score < floor;
        })
        .map(d => d.id);

    return {
        meetingId: config.id,
        title: config.title,
        overall: Math.round(overall * 1000) / 1000,
        dimensions,
        passed: overall >= thresholds.overall && failures.length === 0,
        failures,
    };
}

export interface MeetingEvalSuiteReport {
    total: number;
    passed: number;
    failed: number;
    /** Mean overall score across the suite. */
    meanScore: number;
    /** Mean score per dimension, so a regression can be attributed. */
    byDimension: Record<string, number>;
    results: MeetingEvalResult[];
}

export function summarizeMeetingEvals(results: MeetingEvalResult[]): MeetingEvalSuiteReport {
    const byDimension: Record<string, { sum: number; count: number }> = {};
    for (const result of results) {
        for (const dimension of result.dimensions) {
            const entry = (byDimension[dimension.id] ??= { sum: 0, count: 0 });
            entry.sum += dimension.score;
            entry.count++;
        }
    }

    const passed = results.filter(r => r.passed).length;
    return {
        total: results.length,
        passed,
        failed: results.length - passed,
        meanScore:
            results.length === 0
                ? 0
                : Math.round((results.reduce((s, r) => s + r.overall, 0) / results.length) * 1000) /
                  1000,
        byDimension: Object.fromEntries(
            Object.entries(byDimension).map(([id, { sum, count }]) => [
                id,
                Math.round((sum / count) * 1000) / 1000,
            ])
        ),
        results,
    };
}
