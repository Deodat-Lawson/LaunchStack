/**
 * The reusable-answer library: which saved answers speak to a question.
 * Keyword overlap, no model — it runs before every draft and must be cheap
 * and explainable ("reused because it answers the same question").
 */
import type { LibraryItemRecord } from "./types";
import { similarity } from "./text";

export interface LibraryMatch {
    item: LibraryItemRecord;
    score: number;
}

export const LIBRARY_MATCH_THRESHOLD = 0.18;

/** Saved answers whose question overlaps this one, best first. */
export function matchLibrary(
    question: string,
    items: LibraryItemRecord[],
    limit = 3,
    threshold = LIBRARY_MATCH_THRESHOLD
): LibraryMatch[] {
    return items
        .map(item => ({
            item,
            score: Math.max(
                similarity(question, item.question),
                // Tags are a person's own words for what the answer covers.
                item.tags.length > 0 ? similarity(question, item.tags.join(" ")) * 0.9 : 0
            ),
        }))
        .filter(m => m.score >= threshold)
        .sort((a, b) => b.score - a.score || b.item.uses - a.item.uses)
        .slice(0, limit);
}

/** The block a draft prompt reads: prior answers it may adapt, never copy blindly. */
export function formatLibraryBlock(matches: LibraryMatch[]): string {
    if (matches.length === 0) return "(no saved answers match this question)";
    return matches
        .map(
            (m, i) =>
                `Saved answer ${i + 1} — to "${m.item.question}":\n${m.item.answer.slice(0, 2_500)}`
        )
        .join("\n\n");
}
