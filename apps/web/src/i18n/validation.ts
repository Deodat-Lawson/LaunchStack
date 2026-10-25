/**
 * The English a zod schema is given for its messages, from the
 * `errors.validation` catalogue: `.min(1, V.questionRequired)`. A zod issue
 * carries only the string, so the route that answers with it words it in the
 * reader's language by finding that string again (`zodIssueText` in ./zod).
 * Writing the sentence here rather than in the schema is what keeps the two
 * from drifting apart.
 *
 * Client-safe: the settings form validates with the same schemas.
 */

import { createTranslator } from "next-intl";

import errors from "./messages/en/errors.json";

/** The plain sentences, as they are. */
export const V = errors.validation;

const english = createTranslator({
    locale: "en",
    messages: { errors },
    namespace: "errors.validation",
});

/** A sentence that takes values: `v("keepItUnder", { max: 120 })`. */
export function v(
    key: "keepItUnder" | "textTooLong" | "embeddingVectorLength",
    values: Record<string, string | number>
): string {
    return english(key, values as never);
}
