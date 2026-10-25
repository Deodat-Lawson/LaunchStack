/**
 * How scenario data is said and coloured in the UI — stance words, the
 * diverging stance scale, progress copy. Shared by the Scenarios tab and
 * Brand's post tests; plain data, no React.
 *
 * The words come in two forms. The English constants and functions
 * (`STANCE_LABEL`, `progressWords`, …) are kept for callers that have not
 * moved to the catalogue yet; new code takes a translator for
 * `scenarios.words` — `useTranslations("scenarios.words")` — and the locale
 * (`stanceLabel(t, s)`, `progressLabel(t, run)`, `formatPercent(rate, locale)`).
 */
import type { useTranslations } from "next-intl";

import type {
    ScenarioSource,
    ScenarioStage,
    ScenarioStatus,
    ScenarioSummary,
    Stance,
} from "~/lib/scenarios/types";

/** A translator for the `scenarios.words` messages. */
export type ScenarioWordsT = ReturnType<typeof useTranslations<"scenarios.words">>;

/** Stances from most critical to most supportive, the order of `stanceCounts`. */
export const STANCES: readonly Stance[] = [-2, -1, 0, 1, 2];

/** English; kept for callers not yet on the catalogue. New code: `stanceLabel(t, s)`. */
export const STANCE_LABEL: Record<Stance, string> = {
    [-2]: "Strongly critical",
    [-1]: "Critical",
    [0]: "Neutral",
    [1]: "Supportive",
    [2]: "Strongly supportive",
};

/** Series keys for the chart (CSS custom property names can't start with a minus). */
export const STANCE_KEY: Record<Stance, string> = {
    [-2]: "critical2",
    [-1]: "critical1",
    [0]: "neutral",
    [1]: "supportive1",
    [2]: "supportive2",
};

/**
 * A diverging scale built from the status tokens: danger for critical, info
 * for supportive, the ink ladder for neutral. Red against blue stays apart for
 * the common colour-vision deficiencies (red against green would not); the
 * milder steps and the neutral middle are mixed toward the panel (in oklab,
 * so the hue does not swing on the way), so the
 * scale is lightest in the middle and reads by lightness as well as hue.
 * Every use also carries the word.
 */
export const STANCE_COLOR: Record<Stance, string> = {
    [-2]: "var(--danger)",
    [-1]: "color-mix(in oklab, var(--danger) 60%, var(--panel))",
    [0]: "color-mix(in oklab, var(--ink-4) 50%, var(--panel))",
    [1]: "color-mix(in oklab, var(--info) 60%, var(--panel))",
    [2]: "var(--info)",
};

/** The same scale as background classes, for dots and bars. */
export const STANCE_BG: Record<Stance, string> = {
    [-2]: "bg-danger",
    [-1]: "bg-danger/60",
    [0]: "bg-ink-4/50",
    [1]: "bg-info/60",
    [2]: "bg-info",
};

export const FACTION_BG: Record<"supportive" | "neutral" | "critical", string> = {
    supportive: "bg-info",
    neutral: "bg-ink-4",
    critical: "bg-danger",
};

/** A mean stance (−2…+2) in English words. New code: `moodLabel(t, mean)`. */
export function moodWords(mean: number): string {
    if (mean <= -1.2) return "strongly critical";
    if (mean <= -0.4) return "critical";
    if (mean < 0.4) return "mixed";
    if (mean < 1.2) return "supportive";
    return "strongly supportive";
}

/** "+0.4", "−1.2", "0.0": a signed mean with a real minus sign. In the locale: `formatSigned`. */
export function signed(n: number): string {
    const fixed = Math.abs(n).toFixed(1);
    if (fixed === "0.0") return "0.0";
    return `${n > 0 ? "+" : "−"}${fixed}`;
}

export function isLive(status: ScenarioStatus): boolean {
    return status === "queued" || status === "running";
}

/** Where a run is, in English: "Gathering sources", "Round 3 of 8". New code: `progressLabel(t, run)`. */
export function progressWords(run: {
    status: ScenarioStatus;
    stage: ScenarioStage;
    round: number;
    rounds: number;
    agents: number;
}): string {
    switch (run.status) {
        case "queued":
            return "Waiting to start";
        case "failed":
            return "Failed";
        case "cancelled":
            return "Cancelled";
        case "done":
            return "Done";
        case "running":
            return stageWords(run);
    }
}

function stageWords(run: {
    stage: ScenarioStage;
    round: number;
    rounds: number;
    agents: number;
}): string {
    switch (run.stage) {
        case "gathering":
            return "Gathering sources";
        case "casting":
            return `Building ${run.agents} people`;
        case "simulating":
            return `Round ${Math.min(run.round + 1, run.rounds)} of ${run.rounds}`;
        case "reporting":
            return "Writing the report";
        case "done":
            return "Done";
    }
}

/** 0–100 for a progress bar. */
export function progressValue(run: {
    status: ScenarioStatus;
    stage: ScenarioStage;
    round: number;
    rounds: number;
}): number {
    if (run.status === "done") return 100;
    if (run.status === "queued") return 2;
    switch (run.stage) {
        case "gathering":
            return 6;
        case "casting":
            return 14;
        case "simulating":
            return Math.round(16 + (78 * run.round) / Math.max(1, run.rounds));
        case "reporting":
            return 96;
        case "done":
            return 100;
    }
}

/** Two letters for an avatar: "Maya Lindqvist" → "ML". */
export function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? "?";
    const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
    return `${first}${last}`.toUpperCase();
}

/** A 0–1 rate as a percentage; one decimal under 10%, where a point matters. In the locale: `formatPercent`. */
export function percent(rate: number): string {
    const p = rate * 100;
    if (p > 0 && p < 10) return `${p.toFixed(1)}%`;
    return `${Math.round(p)}%`;
}

/** A handle as people read it: exactly one leading "@" (the API sends handles with it). */
export function atHandle(handle: string): string {
    return `@${handle.replace(/^@+/, "")}`;
}

// ─── In the reader's language ────────────────────────────────────────────────

/** The message key under `scenarios.words.stance` for each stance. */
export type StanceWordKey =
    | "stronglyCritical"
    | "critical"
    | "neutral"
    | "supportive"
    | "stronglySupportive";

export const STANCE_WORD_KEY: Record<Stance, StanceWordKey> = {
    [-2]: "stronglyCritical",
    [-1]: "critical",
    [0]: "neutral",
    [1]: "supportive",
    [2]: "stronglySupportive",
};

/** "Strongly critical" … "Strongly supportive", in the reader's language. */
export function stanceLabel(t: ScenarioWordsT, stance: Stance): string {
    return t(`stance.${STANCE_WORD_KEY[stance]}`);
}

/** The message key under `scenarios.words.mood` for a mean stance (−2…+2). */
export function moodKey(
    mean: number
): "stronglyCritical" | "critical" | "mixed" | "supportive" | "stronglySupportive" {
    if (mean <= -1.2) return "stronglyCritical";
    if (mean <= -0.4) return "critical";
    if (mean < 0.4) return "mixed";
    if (mean < 1.2) return "supportive";
    return "stronglySupportive";
}

/** A mean stance in words, lower case where the language has case: "mixed". */
export function moodLabel(t: ScenarioWordsT, mean: number): string {
    return t(`mood.${moodKey(mean)}`);
}

/** Where a run is, in a few words: "Gathering sources", "Round 3 of 8". */
export function progressLabel(
    t: ScenarioWordsT,
    run: {
        status: ScenarioStatus;
        stage: ScenarioStage;
        round: number;
        rounds: number;
        agents: number;
    }
): string {
    switch (run.status) {
        case "queued":
            return t("progress.queued");
        case "failed":
            return t("progress.failed");
        case "cancelled":
            return t("progress.cancelled");
        case "done":
            return t("progress.done");
        case "running":
            switch (run.stage) {
                case "gathering":
                    return t("progress.gathering");
                case "casting":
                    return t("progress.casting", { count: run.agents });
                case "simulating":
                    return t("progress.simulating", {
                        round: Math.min(run.round + 1, run.rounds),
                        rounds: run.rounds,
                    });
                case "reporting":
                    return t("progress.reporting");
                case "done":
                    return t("progress.done");
            }
    }
}

/** "30 people · 8 rounds". */
export function sizeLabel(
    t: ScenarioWordsT,
    run: Pick<ScenarioSummary, "agents" | "rounds">
): string {
    return t("size", { agents: run.agents, rounds: run.rounds });
}

/** The message key under `scenarios.words.sourceKind` for each kind of source. */
export const SOURCE_KIND_KEY: Record<
    ScenarioSource["kind"],
    "document" | "search" | "prospect" | "brandComment" | "companyProfile" | "notes"
> = {
    document: "document",
    search: "search",
    prospect: "prospect",
    brand_comment: "brandComment",
    company_profile: "companyProfile",
    notes: "notes",
};

export function sourceKindLabel(t: ScenarioWordsT, kind: ScenarioSource["kind"]): string {
    return t(`sourceKind.${SOURCE_KIND_KEY[kind]}`);
}

/** "+0.4", "−1.2", "0.0" in the locale's digits, with a real minus sign. */
export function formatSigned(n: number, locale: string): string {
    const format = new Intl.NumberFormat(locale, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
    });
    if (Math.abs(n).toFixed(1) === "0.0") return format.format(0);
    return `${n > 0 ? "+" : "−"}${format.format(Math.abs(n))}`;
}

/** A 0–1 rate as a percentage in the locale; one decimal under 10%, where a point matters. */
export function formatPercent(rate: number, locale: string): string {
    const p = rate * 100;
    const digits = p > 0 && p < 10 ? 1 : 0;
    return new Intl.NumberFormat(locale, {
        style: "percent",
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    }).format(rate);
}

/** "a", "a and b", "a, b and c" — joined the way the language joins a list. */
export function joinLabels(t: ScenarioWordsT, items: string[]): string {
    if (items.length <= 1) return items.join("");
    const last = items[items.length - 1]!;
    const rest = items.slice(0, -1).join(t("list.separator"));
    return t("list.last", { rest, last });
}
