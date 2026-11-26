/**
 * The recorded register search as a discovery environment: a search word's
 * requests are its pages of 20 results, in order.
 */
import type { DiscoveryEnv, ResultItem, TermCursor } from "../lib/discovery";
import { PAGE_SIZE, nameTokens, type RegisterWorld } from "./world";

export function createEnv(world: RegisterWorld): DiscoveryEnv {
    const cutShort = new Set(world.cutShort ?? []);
    const open = (term: string): TermCursor => {
        const pages = world.pages[term] ?? [];
        let next = 0;
        const items = (page: number): ResultItem[] =>
            (pages[page] ?? []).map(company => ({
                id: company.id,
                name: company.name,
                target: company.code === world.segment.code,
            }));
        return {
            pending: () => pages.length - next,
            peek: () => (next < pages.length ? items(next) : null),
            next: () => items(next++),
            // Complete only when the recording holds every match of the word: a
            // word cut short by a request that got no answer never is. (The
            // unanswered page itself is not a request a policy can send here:
            // the recording simply ends before it.)
            complete: () =>
                next >= pages.length &&
                !cutShort.has(term) &&
                (world.totals[term] ?? 0) <= pages.length * PAGE_SIZE,
        };
    };
    return {
        cap: PAGE_SIZE,
        planTerms: world.terms.plan,
        letterTerms: [],
        allTerms: () => Object.keys(world.pages),
        hasTerm: term => world.pages[term] !== undefined,
        open,
        tokens: nameTokens,
        // The register's name search matches whole words.
        wordMatches: (nameWord, queryWord) => nameWord === queryWord,
        keysOf: nameWord => [nameWord],
    };
}
