/**
 * The brief of a segment, built by production's `buyerBrief`: the paragraph
 * every policy starts from.
 *
 * No partner kind and no seller profile is passed. The labels here say what
 * kind of business a company is, not what role it would play for the seller,
 * and there is no real seller behind these segments (see the README's limits).
 */
import { BASELINE_TEXT, buyerBrief } from "../../../src/distribution/semantic";
import { SEGMENTS, type Segment, type SegmentText } from "./segments";

export function briefOf(text: SegmentText): string {
    return buyerBrief(
        { offering: text.offering, categories: text.categories, constraints: null },
        []
    );
}

export type BriefLanguage = "en" | "no";

export function segmentText(segment: Segment, language: BriefLanguage): SegmentText {
    if (language === "en") return { offering: segment.offering, categories: segment.categories };
    if (!segment.norwegian) throw new Error(`${segment.id} has no Norwegian brief`);
    return segment.norwegian;
}

/** Every text embedded as a query: all briefs in both languages, and the baseline. */
export function allQueryTexts(): string[] {
    const out = [BASELINE_TEXT];
    for (const segment of SEGMENTS) {
        out.push(briefOf(segmentText(segment, "en")));
        if (segment.norwegian) out.push(briefOf(segmentText(segment, "no")));
    }
    return out;
}
