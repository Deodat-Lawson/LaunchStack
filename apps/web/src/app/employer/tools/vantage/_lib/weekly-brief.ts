import type { DemoReport } from "../demo-contract";

export interface WeeklyBriefView {
    preview: string;
    /** Exact stored text, including paragraph boundaries and qualifications. */
    fullSummary: string;
}

const abbreviations =
    /(?:^|\s)(?:Mr|Mrs|Ms|Mx|Dr|Prof|Sr|Jr|St|Mt|vs|etc|No|Fig|Dept|Inc|Ltd|Corp|approx|cf|al|e\.g|i\.e|Ph\.D|a\.m|p\.m|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.$/i;
const closingPunctuation = /["'\u201d\u2019\u00bb)\]}]/;

/**
 * Select existing text only. Ambiguous abbreviations/ellipses are kept with the
 * following text rather than risking a clipped date, name or qualification.
 * This is a conservative presentation boundary, not a semantic summary.
 */
export function firstSummarySentence(summary: string): string {
    const text = summary.trim();
    for (let index = 0; index < text.length; index += 1) {
        const punctuation = text[index]!;
        if (!/[.!?\u3002\uff01\uff1f]/.test(punctuation)) continue;
        if (punctuation === ".") {
            const prefix = text.slice(0, index + 1);
            if (
                text[index - 1] === "." ||
                text[index + 1] === "." ||
                abbreviations.test(prefix) ||
                /(?:^|\s)[A-Za-z]\.$/.test(prefix) ||
                /(?:^|\s)(?:[A-Za-z]\.){2,}$/.test(prefix) ||
                /(?:^|\n)\s*\d+\.$/.test(prefix) ||
                (/\d\.$/.test(prefix) && /^\s+\d/.test(text.slice(index + 1)))
            ) {
                continue;
            }
        }
        let end = index + 1;
        while (end < text.length && /[!?\uff01\uff1f]/.test(text[end]!)) end += 1;
        while (end < text.length && closingPunctuation.test(text[end]!)) end += 1;
        // Western punctuation inside decimals, dates, URLs and identifiers is
        // not a boundary. CJK sentence punctuation does not require a space.
        if (
            end < text.length &&
            !/\s/.test(text[end]!) &&
            !/[\u3002\uff01\uff1f]/.test(punctuation)
        ) {
            continue;
        }
        return text.slice(0, end);
    }
    return text;
}

/** No facts, titles, conflicts or suggested actions are promoted into the brief. */
export function selectWeeklyBrief(report: DemoReport): WeeklyBriefView {
    return { preview: firstSummarySentence(report.summary), fullSummary: report.summary };
}
