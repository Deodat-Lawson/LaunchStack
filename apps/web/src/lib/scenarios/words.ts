/**
 * How scenario data is said and coloured in the UI — stance words, the
 * diverging stance scale, progress copy. Shared by the Scenarios tab and
 * Brand's post tests; plain data, no React.
 */
import type {
    ScenarioSource,
    ScenarioStage,
    ScenarioStatus,
    ScenarioSummary,
    Stance,
} from "~/lib/scenarios/types";

/** Stances from most critical to most supportive, the order of `stanceCounts`. */
export const STANCES: readonly Stance[] = [-2, -1, 0, 1, 2];

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

/** A mean stance (−2…+2) in words. */
export function moodWords(mean: number): string {
    if (mean <= -1.2) return "strongly critical";
    if (mean <= -0.4) return "critical";
    if (mean < 0.4) return "mixed";
    if (mean < 1.2) return "supportive";
    return "strongly supportive";
}

/** "+0.4", "−1.2", "0.0": a signed mean with a real minus sign. */
export function signed(n: number): string {
    const fixed = Math.abs(n).toFixed(1);
    if (fixed === "0.0") return "0.0";
    return `${n > 0 ? "+" : "−"}${fixed}`;
}

export function isLive(status: ScenarioStatus): boolean {
    return status === "queued" || status === "running";
}

/** Where a run is, in a few words: "Gathering sources", "Round 3 of 8". */
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

export function sizeWords(run: Pick<ScenarioSummary, "agents" | "rounds">): string {
    return `${run.agents} people · ${run.rounds} ${run.rounds === 1 ? "round" : "rounds"}`;
}

export const SOURCE_KIND_LABEL: Record<ScenarioSource["kind"], string> = {
    document: "File",
    search: "Found in your files",
    prospect: "Prospect",
    brand_comment: "Comment on your post",
    company_profile: "Company profile",
    notes: "Pasted material",
};

/** Two letters for an avatar: "Maya Lindqvist" → "ML". */
export function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? "?";
    const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
    return `${first}${last}`.toUpperCase();
}

/** A 0–1 rate as a percentage; one decimal under 10%, where a point matters. */
export function percent(rate: number): string {
    const p = rate * 100;
    if (p > 0 && p < 10) return `${p.toFixed(1)}%`;
    return `${Math.round(p)}%`;
}
