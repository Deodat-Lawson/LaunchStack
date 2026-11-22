import { LEXICAL_SPEC } from "@launchstack/pipelines/vantage/question-lexical-ranking";
import type { PersonalTopic } from "./weekly-review-personal-topics";
import { normalizeTopicExcerpt } from "./weekly-review-topic-exploration";

type Span = { start: number; end: number };
type Match = Span & { token: string };
const stopwords = new Set(LEXICAL_SPEC.stopwords.split(" "));
const tokens = (text: string) => text.match(/[\p{L}\p{N}]+/gu) ?? [];
const normalized = (text: string) => text.normalize("NFKC").toLocaleLowerCase("en-US");

/** Source offsets stay canonical UTF16; normalization applies only to token comparison. */
export function lexicalBackfillSpan(
    text: string,
    topics: readonly Pick<PersonalTopic, "openQuestions" | "keywords">[],
    maxBytes: number
): Span | null {
    if (text.length < 200 || maxBytes < 200) return null;
    const terms = new Set<string>();
    for (const topic of topics) {
        for (const question of topic.openQuestions)
            for (const token of tokens(normalized(question)))
                if (token.length >= LEXICAL_SPEC.minTokenCharacters && !stopwords.has(token))
                    terms.add(token);
        for (const keyword of topic.keywords ?? [])
            for (const token of tokens(normalized(keyword))) terms.add(token);
    }
    if (!terms.size) return null;
    const matches: Match[] = [];
    for (const match of text.matchAll(/[\p{L}\p{N}]+/gu)) {
        const token = normalized(match[0]);
        if (terms.has(token))
            matches.push({ start: match.index, end: match.index + match[0].length, token });
    }
    const centered = (anchor: Match, length: number) => {
        const center = (anchor.start + anchor.end) / 2;
        const start = Math.max(0, Math.min(text.length - length, Math.floor(center - length / 2)));
        return normalizeTopicExcerpt(text, { start, end: Math.min(text.length, start + length) });
    };
    const counts = new Map<string, number>();
    const candidates: { anchor: Match; span: Span; unique: number; hits: number }[] = [];
    let left = 0,
        right = 0;
    for (const anchor of matches) {
        const span = centered(anchor, Math.min(6000, text.length));
        if (!span) continue;
        while (right < matches.length && matches[right]!.end <= span.end) {
            const token = matches[right++]!.token;
            counts.set(token, (counts.get(token) ?? 0) + 1);
        }
        while (left < right && matches[left]!.start < span.start) {
            const token = matches[left++]!.token;
            const remaining = counts.get(token)! - 1;
            if (remaining) counts.set(token, remaining);
            else counts.delete(token);
        }
        candidates.push({ anchor, span, unique: counts.size, hits: right - left });
    }
    candidates.sort(
        (a, b) =>
            b.unique - a.unique ||
            b.hits - a.hits ||
            a.span.start - b.span.start ||
            a.anchor.start - b.anchor.start
    );
    for (const { anchor } of candidates) {
        let low = Math.max(200, anchor.end - anchor.start),
            high = Math.min(6000, text.length),
            best: Span | null = null;
        while (low <= high) {
            const length = Math.floor((low + high) / 2);
            const span = centered(anchor, length);
            const fits =
                span &&
                span.start <= anchor.start &&
                span.end >= anchor.end &&
                Buffer.byteLength(text.slice(span.start, span.end), "utf8") <= maxBytes;
            if (fits) {
                best = span;
                low = length + 1;
            } else high = length - 1;
        }
        if (best) return best;
    }
    return null;
}
