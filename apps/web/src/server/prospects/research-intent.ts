/** How long a started profile may stay quiet before another open may try again. */
export const RESEARCH_FRESH_MS = 3 * 60 * 1000;

export type ResearchIntent = "none" | "pending" | "start";

/**
 * Whether opening a company should start its profile.
 *
 * A dossier means there is nothing to do. A start that is still fresh means
 * one is already running, including for a poll that did not ask to start.
 * Asking again after a finished attempt (or a start that went quiet) begins
 * another. A poll never begins one.
 */
export function researchIntent(
    events: readonly { type: string; occurredAt: Date }[],
    hasDossier: boolean,
    requested: boolean,
    now = new Date()
): ResearchIntent {
    if (hasDossier) return "none";
    const latest = events[0];
    if (
        latest?.type === "research_started" &&
        now.getTime() - latest.occurredAt.getTime() < RESEARCH_FRESH_MS
    ) {
        return "pending";
    }
    if (!requested) return "none";
    return "start";
}
