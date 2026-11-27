/**
 * How much a Prospects segment's answers may hold, and which answer is over.
 * One list for the form (which says so beside the field, before anything is
 * sent), the segment routes (which refuse the same things, naming the field
 * and the limit) and the Growth harness.
 *
 * "What you sell" and the kinds of buyer go into company search queries and
 * the buyer-matching embedding as they are, so they stay bounded; a place is
 * geocoded as one string. The name is made from the answers, so it is cut to
 * fit its column, never a reason to refuse.
 */
export const SEGMENT_LIMITS = {
    /** Characters in the segment's name (its database column). */
    name: 256,
    /** Characters in "What you sell". */
    offering: 4_000,
    /** Characters in one kind of buyer ("Restaurants"). */
    buyer: 200,
    /** Kinds of buyer. */
    buyers: 20,
    /** Characters in one place ("Baltimore, MD, USA"). */
    place: 200,
    /** Places. */
    places: 20,
} as const;

/**
 * One answer over its limit. `key` names the sentence that says so, the same
 * key under `growth.prospects.setup` (beside the field) and
 * `growth.server.errors` (from the route); `count` and `max` fill it in.
 */
export interface SegmentLimitProblem {
    field: "offering" | "buyers" | "places";
    key: "offeringTooLong" | "buyerTooLong" | "buyersTooMany" | "placeTooLong" | "placesTooMany";
    count: number;
    max: number;
}

/** Every answer over its limit, in the order the form asks them. Only the answers given are checked. */
export function segmentLimitProblems(answers: {
    offering?: string;
    industries?: readonly string[];
    places?: readonly string[];
}): SegmentLimitProblem[] {
    const problems: SegmentLimitProblem[] = [];
    const longest = (items: readonly string[]) => Math.max(0, ...items.map(item => item.length));

    if (answers.industries) {
        const buyer = longest(answers.industries);
        if (buyer > SEGMENT_LIMITS.buyer)
            problems.push({
                field: "buyers",
                key: "buyerTooLong",
                count: buyer,
                max: SEGMENT_LIMITS.buyer,
            });
        if (answers.industries.length > SEGMENT_LIMITS.buyers)
            problems.push({
                field: "buyers",
                key: "buyersTooMany",
                count: answers.industries.length,
                max: SEGMENT_LIMITS.buyers,
            });
    }
    if (answers.places) {
        const place = longest(answers.places);
        if (place > SEGMENT_LIMITS.place)
            problems.push({
                field: "places",
                key: "placeTooLong",
                count: place,
                max: SEGMENT_LIMITS.place,
            });
        if (answers.places.length > SEGMENT_LIMITS.places)
            problems.push({
                field: "places",
                key: "placesTooMany",
                count: answers.places.length,
                max: SEGMENT_LIMITS.places,
            });
    }
    if (answers.offering !== undefined && answers.offering.length > SEGMENT_LIMITS.offering)
        problems.push({
            field: "offering",
            key: "offeringTooLong",
            count: answers.offering.length,
            max: SEGMENT_LIMITS.offering,
        });
    return problems;
}

/** A segment name that fits its column: cut with an ellipsis when the answers it is made from run long. */
export function fitSegmentName(name: string): string {
    const trimmed = name.trim();
    if (trimmed.length <= SEGMENT_LIMITS.name) return trimmed;
    let cut = trimmed.slice(0, SEGMENT_LIMITS.name - 1);
    // Never end on half of a character that takes two code units (an emoji).
    const last = cut.charCodeAt(cut.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
    return `${cut.trimEnd()}…`;
}
