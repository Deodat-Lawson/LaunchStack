/**
 * Build the `search_query` value for the arXiv API.
 *
 * Each word becomes its own `all:` term, grouped in parentheses, so a category
 * filter applies to the whole query. Sent as one `all:` term separated by
 * spaces, the words match independently and the `AND cat:` no longer restricts
 * the results. The words stay ORed, as before: requiring every word returns
 * nothing for natural-language queries (arXiv ignores stop words like "for"),
 * and relevance sorting already ranks papers matching more words first.
 *
 * Words with no letter or digit (a lone `&`, `-`) are dropped.
 * The returned string is already URL-encoded for the query string.
 * See https://info.arxiv.org/help/api/user-manual.html#query_details
 */
export function arxivSearchQuery(query: string, category?: string): string {
    const terms = query
        .replace(/["()]/g, " ")
        .split(/\s+/)
        .filter(word => /[\p{L}\p{N}]/u.test(word))
        .map(word => `all:${encodeURIComponent(word)}`);
    const words = `%28${terms.join("+OR+")}%29`;
    return category ? `${words}+AND+cat:${encodeURIComponent(category)}` : words;
}
